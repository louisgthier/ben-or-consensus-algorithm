import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());
  
  const state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 1
  };

  var proposals: Map<number, number[]> = new Map();
  var votes: Map<number, number[]> = new Map();

  function sendMessage(k: number, x: Value, messageType: string) {
    for (let i = 0; i < N; i++) {
      fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ k: k, x: x, messageType: messageType })
      });
    }
  }

  // GET /status
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // GET /getState
  // this route should respond with the current state of the node defined by the NodeState type below.
  node.get("/getState", (req, res) => {
    res.status(200).send(state);
  });

  function processProposal(k: number, x: number) {
    if (!proposals.has(k)) {
      proposals.set(k, []);
    }
    let proposal = proposals.get(k);
    if (proposal !== undefined) {
        proposal.push(x);
    }

    if (proposals.get(k)!.length >= (N - F)) {
      const count0 = proposals.get(k)!.filter((x) => x === 0).length;
      const count1 = proposals.get(k)!.filter((x) => x === 1).length;

      const x = count0 > (N / 2) ? 0 : (count1 > (N / 2) ? 1 : "?");

      sendMessage(k, x, "vote");
    }
  }

  function processVote(k: number, x: number) {
    if (!votes.has(k)) {
      votes.set(k, []);
    }
    let vote = votes.get(k);
    if (vote !== undefined) {
        vote.push(x);
    }

    if (votes.get(k)!.length >= (N - F)) {
      const count0 = votes.get(k)!.filter((x) => x === 0).length;
      const count1 = votes.get(k)!.filter((x) => x === 1).length;

      if (count0 >= F + 1 || count1 >= F + 1) {
        state.x = count0 > count1 ? 0 : 1;
        state.decided = true;
      } else {
        if (count0 === count1) {
          if (Math.random() < 0.5) {
            state.x = 0;
          } else {
            state.x = 1;
          }
        } else {
          if (count0 > count1) {
            state.x = 0;
          } else {
            state.x = 1;
          }
        }
        state.k = state.k as number + 1;

        sendMessage(state.k, state.x, "proposal");
      }
    }
  }

  // this route allows the node to receive messages from other nodes
  // POST /message
  node.post("/message", async (req, res) => {

    if (isFaulty || state.killed) {
      res.status(500).send("The node is faulty or stopped.");
      return;
    }

    const { k, x, messageType } = req.body;

    if (messageType === "proposal") {
      processProposal(k, x);
    } else if (messageType === "vote") {
      processVote(k, x);
    }

    // respond with the current state of the node
    res.status(200).send(state);
  });

  // this route is used to start the consensus algorithm
  // GET /start
  node.get("/start", async (req, res) => {

    while (!nodesAreReady()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    
    if (!isFaulty) {
      sendMessage(state.k as number, state.x as Value, "proposal");
      res.status(200).send("The node is started.");
    } else {
      res.status(500).send("The node is faulty.");
    }
  });

  // this route is used to stop the consensus algorithm
  // GET /stop
  node.get("/stop", async (req, res) => {
    state.killed = true;
    state.x = null;
    state.decided = null;
    state.k = 0;
    res.send("The node is stopped.");
  });


  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
