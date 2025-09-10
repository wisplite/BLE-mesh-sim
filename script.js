var UPDATE_INTERVAL = 10;
var CONNECTION_DISTANCE = 250;
var DROP_PENALTY = 1.2;
var TTL = 5;
var MAX_CONNECTIONS = 6;
var warningModalShown = false;
var displayWarningWhenDone = false;
var stillRouting = false;
var markNeighborInterval = null;
var showGrid = false;
var showUpdates = false;
// Track all active intervals for marking neighbors, and a cancel flag
var markNeighborIntervals = new Set();
var cancelMarkNeighborRequested = false;
var markNeighborRafs = new Set();

function smoothColorTransition(color1, color2, min, max, current) {
    // Clamp current between min and max
    const clamped = Math.min(Math.max(current, min), max);
  
    // Convert hex to RGB
    const hexToRgb = (hex) => {
      hex = hex.replace(/^#/, "");
      if (hex.length === 3) {
        hex = hex
          .split("")
          .map((c) => c + c)
          .join("");
      }
      const num = parseInt(hex, 16);
      return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
      };
    };
  
    // Convert RGB to hex
    const rgbToHex = (r, g, b) =>
      "#" +
      [r, g, b]
        .map((x) => {
          const hex = x.toString(16);
          return hex.length === 1 ? "0" + hex : hex;
        })
        .join("");
  
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
  
    // Normalize factor (0 → min, 1 → max)
    const t = (clamped - min) / (max - min);
  
    // Interpolate each channel
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);
  
    return rgbToHex(r, g, b);
  }

var nodes = new vis.DataSet([
]);

var edges = new vis.DataSet([
]);

var nodeTable = {};

var grid = new GridIndex(CONNECTION_DISTANCE);

var container = document.getElementById('simContainer');

var data = {
    nodes: nodes,
    edges: edges,
};

var options = {
    nodes: {
        shape: 'box',
        physics: false,
    },
    edges: {
        physics: true,
        smooth: {
            enabled: false,
        },
        arrows: {
            to: {
                enabled: true,
                scaleFactor: 0.5,
            }
        },
    },
    physics: {
        enabled: true,
    }
};

var network = new vis.Network(container, data, options);
let selectedNode = null;

var dotNodes = new vis.DataSet([
]);

var forwardTable = {};

var onEdgeEngine = new CompleteNodeOnEdgeEngine(network, nodes, dotNodes, edges, forwardTable);
onEdgeEngine.createEdgesTable();
onEdgeEngine.initMovement();
onEdgeEngine.setArrivalCallback(async ({ from, to, dot }) => {
    var ttl = parseInt(dot.id.split('-')[2]); 
    if (stillRouting) {
        await routePacket(to, dot.id.split('-')[4], dot.id);
        return;
    }
    if (document.getElementById('showTTL').checked) {
        edges.update({id: `${from}->${to}`, color: {color: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1), highlight: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1)}});
        edges.update({id: `${to}->${from}`, color: {color: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1), highlight: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1)}});
    } else {
        edges.update({id: `${from}->${to}`, color: {color: '#2b7ce9', highlight: '#2b7ce9'}});
        edges.update({id: `${to}->${from}`, color: {color: '#2b7ce9', highlight: '#2b7ce9'}});
    }
    if (nodeTable[to].packetCache.has(dot.id.split('-')[0])) {
        return;
    }
    // update color of receiving node for visualization
    nodeTable[to].packetCache.add(dot.id.split('-')[0]);
    var packetId = dot.id.split('-')[0];
    var originNode = dot.id.split('-')[3];
    ttl--;
    if (document.getElementById('showTTL').checked) {
        nodes.update({id: to, color: {background: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});        
    } else {
        nodes.update({id: to, color: {background: '#97c2fc'}});
    }
    if (ttl > 0) {
        const neighborsSnapshot = nodeTable[to].connections.slice();
        for (let neighbor of neighborsSnapshot) {
            if (neighbor === from || neighbor === originNode) {
                continue;
            }
            var packetShift = generateRealisticLabel();
            var movingNode = {
                id: `${packetId}-${packetShift}-${ttl}-${originNode}`,
                label: packetId + `-${ttl}`,
                shape: dot.shape,
                size: dot.size,
                color: dot.color,
                font: {
                    color: document.getElementById('darkMode').checked ? '#e0e0e0' : '#000'
                }
            };
            onEdgeEngine.createDotNode(movingNode, to, neighbor);
        }
    } else {
        if (document.getElementById('showTTL').checked) {
            markNeighborsAsFailed(to, from, packetId);
        }
    }
});

function quickPacketRaf(startNode, packetInfo, fromNode, opts = {}) {
	const packetId = packetInfo.split('-')[0];
	const ttlStart = parseInt(packetInfo.split('-')[2]);
	const originNode = packetInfo.split('-')[3];

	// Dequeue with head index (avoid Array.shift() O(n))
	let queue = [{ nodeId: startNode, ttl: ttlStart, from: fromNode }];
	let head = 0;

	// Tuning knobs
	const timeBudgetMs = opts.timeBudgetMs ?? 6; // per frame budget
	const maxPerFrame = opts.maxPerFrame ?? 2000; // hard cap per frame
	let cancelled = false;

	function step() {
		if (cancelled) return;

		const t0 = performance.now();
		let processed = 0;

		while (head < queue.length) {
			const { nodeId, ttl, from } = queue[head++];

			if (ttl < 0) {
				if (document.getElementById('showTTL').checked) {
					markNeighborsAsFailed(nodeId, from, packetId);
				}
				continue;
			}

			const node = nodeTable[nodeId];
			if (!node) continue;

			const cache = node.packetCache;
			if (cache && cache.has(packetId)) continue;

			cache.add(packetId);

            if (document.getElementById('showTTL').checked) {
                nodes.update({id: nodeId, color: {background: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
                edges.update({id: `${from}->${nodeId}`, color: {color: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1), highlight: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
                edges.update({id: `${nodeId}->${from}`, color: {color: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1), highlight: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
            } else {
                nodes.update({id: nodeId, color: {background: '#97c2fc'}});
                edges.update({id: `${from}->${nodeId}`, color: {color: '#2b7ce9', highlight: '#2b7ce9'}});
                edges.update({id: `${nodeId}->${from}`, color: {color: '#2b7ce9', highlight: '#2b7ce9'}});
            }

			// Iterate connections directly (avoid .slice() allocations)
			const neighbors = node.connections || [];
			for (let i = 0; i < neighbors.length; i++) {
				const neighbor = neighbors[i];
				if (neighbor === originNode || neighbor === from) continue;
				queue.push({ nodeId: neighbor, ttl: ttl - 1, from: nodeId });
			}

			processed++;
			if (processed >= maxPerFrame || (performance.now() - t0) >= timeBudgetMs) {
				requestAnimationFrame(step);
				return;
			}
		}
	}

	requestAnimationFrame(step);
	return { cancel: () => { cancelled = true; } };
}

// This is a modified version of quickPacket that contains some extra logic to save routing tables.
// It also disables the TTL colors for unreachable nodes to save performance.
function quickRoute(startNode, packetInfo, fromNode) {
    
    const packetId = packetInfo.split('-')[0];
    const ttlStart = parseInt(packetInfo.split('-')[2]);
    const originNode = packetInfo.split('-')[3];

    const queue = [{ nodeId: startNode, ttl: ttlStart, from: fromNode }];

    while (queue.length > 0) {
        const { nodeId, ttl, from } = queue.shift();

        if (ttl < 0) {
            displayWarningWhenDone = true;
            continue;
        }
        if (nodeTable[nodeId]?.packetCache?.has(packetId)) {
            continue;
        }

        nodeTable[nodeId].packetCache.add(packetId);
        nodeTable[nodeId].routingTable[originNode] = from;

        if (document.getElementById('showTTL').checked) {
            nodes.update({id: nodeId, color: {background: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
            edges.update({id: `${from}->${nodeId}`, color: {color: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1), highlight: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
            edges.update({id: `${nodeId}->${from}`, color: {color: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1), highlight: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
        } else {
            nodes.update({id: nodeId, color: {background: '#97c2fc'}});
            edges.update({id: `${from}->${nodeId}`, color: {color: '#2b7ce9', highlight: '#2b7ce9'}});
            edges.update({id: `${nodeId}->${from}`, color: {color: '#2b7ce9', highlight: '#2b7ce9'}});
        }

        const neighborsSnapshot = (nodeTable[nodeId]?.connections?.slice()) || [];

        for (let neighbor of neighborsSnapshot) {
            if (neighbor === originNode || neighbor === from) {
                continue;
            }
            queue.push({ nodeId: neighbor, ttl: ttl - 1, from: nodeId });
        }
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}  

async function routePacket(currentNode, goalNode, packetInfo, first=false) {
    if (!nodeTable[currentNode]) {
        consoleLog(`Node ${currentNode} not found. Dropping packet.`);
        return;
    }
    if (!nodeTable[goalNode]) {
        consoleLog(`Node ${goalNode} not found. Dropping packet.`);
        return;
    }
    stillRouting = true;
    const packetId = packetInfo.split('-')[0];
    var packetShift = generateRealisticLabel();
    let ttl = parseInt(packetInfo.split('-')[2]);
    nodes.update({id: currentNode, color: {background: '#97c2fc'}});
    nodes.update({id: goalNode, color: {background: '#ff00d9'}});
    if (ttl <= 0) {
        consoleLog(`Packet ${packetId} TTL expired. Dropping packet.`);
        stillRouting = false;
        return;
    }
    if (currentNode === goalNode) {
        consoleLog(`Packet ${packetId} reached ${goalNode}.`);
        stillRouting = false;
        return;
    }
    if (document.getElementById('showTTL').checked) {
        nodes.update({id: currentNode, color: {background: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
    } else {
        if (first) {
            nodes.update({id: currentNode, color: {background: '#ff00d9'}});
        } else {
            nodes.update({id: currentNode, color: {background: 'yellow'}});
        }
    }
    ttl--;
    let nextNode = nodeTable[currentNode].routingTable[goalNode];
    if (!nodeTable[currentNode].connections.includes(nextNode)) {
        consoleLog(`No route found from ${currentNode} to ${goalNode}. Dropping packet.`);
        stillRouting = false;
        return;
    }
    if (nextNode) {
        var movingNode = {
            id: `${packetId}-${packetShift}-${ttl}-${currentNode}-${goalNode}`,
            label: packetId + `-${ttl}`,
            shape: 'dot',
            size: 10,
            color: {
                background: 'white',
                border: 'black'
            },
            font: {color: document.getElementById('darkMode').checked ? '#e0e0e0' : '#000'}
        };
        onEdgeEngine.createDotNode(movingNode, currentNode, nextNode);
        if (document.getElementById('showTTL').checked) {
            edges.update({id: `${currentNode}->${nextNode}`, color: {color: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1), highlight: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
            edges.update({id: `${nextNode}->${currentNode}`, color: {color: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl+1), highlight: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
        } else {
            edges.update({id: `${currentNode}->${nextNode}`, color: {color: 'yellow', highlight: 'yellow'}});
            edges.update({id: `${nextNode}->${currentNode}`, color: {color: 'yellow', highlight: 'yellow'}});
        }
    } else {
        consoleLog(`No route found from ${currentNode} to ${goalNode} via ${nextNode}. Dropping packet.`);
        console.log(nodeTable[currentNode].routingTable)
        stillRouting = false;
    }
}

// RAF-driven neighbor marking system
const markNeighborsAsFailed = (startNodeId, from, packetId, visited = new Set(), opts = {}) => {
	if (cancelMarkNeighborRequested) return;
	if (visited.has(startNodeId)) return;
	visited.add(startNodeId);

	const timeBudgetMs = opts.timeBudgetMs ?? 3;      // tighter budget prevents long frames
	const maxOpsPerFrame = opts.maxOpsPerFrame ?? 500;
	const batchSize = opts.batchSize ?? 256;          // batch visual updates

	// show cancel button when we start work
	if (markNeighborRafs.size === 0 && markNeighborIntervals.size === 0) {
		cancelMarkNeighborRequested = false;
		document.getElementById('cancelMarkNeighbor').style.display = 'block';
	}

	// BFS queue of per-node neighbor iterators (no .slice())
	const tasks = [];
	let head = 0;
	const pushTask = (id, fromId) => {
		const n = nodeTable[id];
		const neighbors = (n && n.connections) ? n.connections : [];
		tasks.push({ nodeId: id, from: fromId, neighbors, idx: 0 });
	};
	pushTask(startNodeId, from);

	// batch updates to reduce DOM churn
	let nodeBatch = [];
	let edgeBatch = [];
	function flushBatches() {
		if (nodeBatch.length) {
			nodes.update(nodeBatch);
			nodeBatch = [];
		}
		if (edgeBatch.length) {
			edges.update(edgeBatch);
			edgeBatch = [];
		}
	}

	let rafId = null;
	function step() {
		if (cancelMarkNeighborRequested) {
			if (rafId != null) {
				cancelAnimationFrame(rafId);
				markNeighborRafs.delete(rafId);
				rafId = null;
			}
			flushBatches();
			if (markNeighborRafs.size === 0 && markNeighborIntervals.size === 0) {
				document.getElementById('cancelMarkNeighbor').style.display = 'none';
			}
			return;
		}

		const deadline = performance.now() + timeBudgetMs;
		let ops = 0;

		while (head < tasks.length) {
			const task = tasks[head];

			// process a few neighbors at a time; yield aggressively
			while (task.idx < task.neighbors.length) {
				const neighbor = task.neighbors[task.idx++];

				if (neighbor === task.from) continue;
				if (visited.has(neighbor)) continue;

				const neighborNode = nodeTable[neighbor];
				if (!neighborNode) continue;
				if (neighborNode.packetCache?.has(packetId)) continue;

				visited.add(neighbor);

				// enqueue child (BFS)
				const nextNeighbors = neighborNode.connections || [];
				tasks.push({ nodeId: neighbor, from: task.nodeId, neighbors: nextNeighbors, idx: 0 });

				// batch visuals
				nodeBatch.push({ id: neighbor, color: { background: 'white' } });
				edgeBatch.push({ id: `${task.nodeId}->${neighbor}`, color: { color: 'white', highlight: '#97c2fc' } });
				edgeBatch.push({ id: `${neighbor}->${task.nodeId}`, color: { color: 'white', highlight: '#97c2fc' } });

				ops++;

				// time/ops-based yield
				if (ops >= maxOpsPerFrame || performance.now() >= deadline) {
					flushBatches(); // flush once per frame
					if (rafId != null) markNeighborRafs.delete(rafId);
					rafId = requestAnimationFrame(step);
					markNeighborRafs.add(rafId);
					return;
				}

				// keep batches bounded
				if (nodeBatch.length >= batchSize || edgeBatch.length >= batchSize * 2) {
					flushBatches();
				}
			}

			// done with this node
			head++;
		}

		// finished
		flushBatches();
		if (rafId != null) {
			markNeighborRafs.delete(rafId);
			rafId = null;
		}
		if (markNeighborRafs.size === 0 && markNeighborIntervals.size === 0) {
			document.getElementById('cancelMarkNeighbor').style.display = 'none';
		}
	}

	rafId = requestAnimationFrame(step);
	markNeighborRafs.add(rafId);
};


function recomputeNodeConnections(nodeId, dragging=false) {
    const p = network.getPosition(nodeId);
    const candidates = grid.getNeighborCandidates(p.x, p.y);

    // cache node positions now to prevent duplicate work later
    const posById = new Map();
    for (let id of candidates) {
        if (nodeTable[id]) {
            posById.set(id, network.getPosition(id));
        }
    }

    // check all nearby nodes against all other nearby nodes
    for (let a of candidates) {
        if (!nodeTable[a]) {
            continue;
        }
        // in case user drags node too fast, drop far connections
        if (dragging) {
            for (let connection of nodeTable[a].connections) {
                const aPos = network.getPosition(a);
                const bPos = network.getPosition(connection);
                const distance = calculateDistance(aPos,bPos);
                if (distance > CONNECTION_DISTANCE) {
                    dropConnection(a,connection);
                }
            }
        }
        if (showUpdates) {
            console.log('updating')
            let lastTime;
            let fadePerS = 10;
            let currentFade = 0;
            let animationId;
            function animateFlash(time) {
                if (!lastTime) {
                    lastTime = time;
                }
                const dTs = (time - lastTime) / 1000;

                lastTime = time;
                const diff = fadePerS * dTs;
                currentFade += diff;
                nodes.update({id: a, color: {background: smoothColorTransition('#eb4034', '#97c2fc', 0, 5, currentFade)}})

                if (currentFade < 5) {
                    animationId = requestAnimationFrame(animateFlash);
                } else {
                    nodes.update({id: a, color: {background: '#97c2fc'}});
                    animationId = null;
                }
            }
            animationId = requestAnimationFrame(animateFlash);
        }
        let trueNeighbors = []
        for (let b of candidates) {
            if (a === b) {
                continue;
            }
            if (!nodeTable[b]) {
                continue;
            }
            const aPos = posById.get(a);
            const bPos = posById.get(b);
            const distance = calculateDistance(aPos,bPos);
            if (distance < CONNECTION_DISTANCE) {
                let connectionScore = 0;
                let dropScore = 0;
                connectionScore += (100 + distanceToRSSI(distance));
                connectionScore += 100 / (nodeTable[b].connections.length + 1);
                if (nodeTable[b].connections.length == 0) {
                    connectionScore += 100;
                }
                if (nodeTable[a].connections.includes(b) && nodeTable[b].connections.length == 1) {
                    // assume current node is only connection
                    connectionScore += 1000;
                }
                if (nodeTable[a].connections.includes(b)) {
                    dropScore = connectionScore * DROP_PENALTY;
                }
                trueNeighbors.push({'nodeId': b, 'distance': distanceToRSSI(distance), 'score': connectionScore, 'dropScore': dropScore});
            } else {
                if (nodeTable[a].connections.includes(b)) {
                    dropConnection(a,b);
                }
            }
        }
        trueNeighbors.sort((aS, bS) => bS.score - aS.score);
        const neighborMap = new Map(trueNeighbors.map(n => [n.nodeId, n]));
        const topCandidates = trueNeighbors.slice(0, MAX_CONNECTIONS);
        let toDrop = new Set();
        let toConnect = new Set();
        for (let node of topCandidates) {
            if (nodeTable[node.nodeId].connections.length >= MAX_CONNECTIONS) {
                continue;
            }
            if (nodeTable[a].connections.length >= MAX_CONNECTIONS || (nodeTable[a].connections.length + toConnect.size) >= MAX_CONNECTIONS) {
                if (nodeTable[a].connections.includes(node.nodeId)) {
                    continue;
                }
                for (let activeConnection of nodeTable[a].connections) {
                    if (toDrop.has(activeConnection)) {
                        continue;
                    }
                    if (neighborMap.get(activeConnection) && neighborMap.get(activeConnection).dropScore < node.score) {
                        toDrop.add(activeConnection);
                        toConnect.add(node.nodeId);
                    }
                }
            } else {
                toConnect.add(node.nodeId);
            }
        }
        if (toDrop.size != 0) {
            for (let drop of toDrop) {
                dropConnection(a, drop);
            }
        }
        if (toConnect.size != 0) {
            for (let connect of toConnect) {
                // if already connected, ignore
                if (nodeTable[a].connections.includes(connect)) {
                    continue;
                }
                nodeTable[a].connections.push(connect);
                nodeTable[connect].connections.push(a);
                connectNodes(a,connect);
            }
        }
    }
}

function computeAllConnectionsFast() {
    // Cache positions and initialize degree/connection sets
    const items = nodes.get(); // [{id,x,y,...}]
    const pos = new Map(items.map(n => [n.id, { x: n.x, y: n.y }]));
    const ids = items.map(n => n.id);

    for (let id of ids) {
        if (!nodeTable[id]) {
            nodeTable[id] = { connections: [], packetCache: new Set(), routingTable: {} };
        }
    }

    const degree = new Map(ids.map(id => [id, nodeTable[id].connections.length || 0]));
    const connSet = new Map(ids.map(id => [id, new Set(nodeTable[id].connections || [])]));

    const newEdges = [];

    // Greedy, capacity-aware linking within neighborhood
    for (let a of ids) {
        const ap = pos.get(a);
        if (!ap) continue;

        const candidates = grid.getNeighborCandidates(ap.x, ap.y);
        const scored = [];

        for (let b of candidates) {
            if (b === a) continue;
            if (!pos.has(b)) continue;
            if (connSet.get(a).has(b)) continue;

            const bp = pos.get(b);
            const d = calculateDistance(ap, bp);
            if (d >= CONNECTION_DISTANCE) continue;

            // Favor closer, low-degree, and isolated nodes
            const bdeg = degree.get(b) || 0;
            let score = 100 + distanceToRSSI(d);
            score += 100 / (bdeg + 1);
            if (bdeg === 0) score += 100;

            scored.push({ id: b, score });
        }

        if (scored.length === 0) continue;
        scored.sort((x, y) => y.score - x.score);

        for (let s of scored) {
            if ((degree.get(a) || 0) >= MAX_CONNECTIONS) break;
            const b = s.id;
            if ((degree.get(b) || 0) >= MAX_CONNECTIONS) continue;
            if (connSet.get(a).has(b)) continue;

            connSet.get(a).add(b);
            connSet.get(b).add(a);
            degree.set(a, (degree.get(a) || 0) + 1);
            degree.set(b, (degree.get(b) || 0) + 1);

            nodeTable[a].connections.push(b);
            nodeTable[b].connections.push(a);

            newEdges.push({ id: `${a}->${b}`, from: a, to: b });
            newEdges.push({ id: `${b}->${a}`, from: b, to: a });

            if ((degree.get(a) || 0) >= MAX_CONNECTIONS) break;
        }
    }

    if (newEdges.length > 0) {
        edges.add(newEdges);
    }
}

function dropConnection(nodeA, nodeB) {
    edges.remove(`${nodeA}->${nodeB}`);
    edges.remove(`${nodeB}->${nodeA}`);
    const aIdx = nodeTable[nodeA].connections.indexOf(nodeB);
    const bIdx = nodeTable[nodeB].connections.indexOf(nodeA);
    if (aIdx !== -1) {
        nodeTable[nodeA].connections.splice(aIdx, 1);
    }
    if (bIdx !== -1) {
        nodeTable[nodeB].connections.splice(bIdx, 1);
    }
}

function onNodeAdd(nodeId, defer=false) {
    // update grid
    const position = network.getPosition(nodeId);
    grid.add(nodeId, position.x, position.y);

    if (!defer) {
        recomputeNodeConnections(nodeId);
    }
    
    var nodeLength = Object.keys(nodeTable).length;
    document.getElementById('nodeCount').innerText = 'Node Count: ' + nodeLength;
}

document.getElementById('addNode').addEventListener('click', function() {
    const nodeId = generateRealisticLabel();
    nodes.add({id: nodeId, label: nodeId});
    nodeTable[nodeId] = {'connections': [], 'packetCache': new Set(), 'routingTable': {}};
    onNodeAdd(nodeId);
});

/*
    NETWORK EVENTS
*/

network.on('click', function(properties) {
    if (properties.nodes.length > 0) {
        selectedNode = properties.nodes[0];
    } else {
        selectedNode = null;
    }
    if (document.getElementById('quickPlace').checked) {
        const nodeId = generateRealisticLabel();
        nodes.add({id: nodeId, label: nodeId, x: properties.pointer.canvas.x, y: properties.pointer.canvas.y});
        nodeTable[nodeId] = {'connections': [], 'packetCache': new Set(), 'routingTable': {}};
        onNodeAdd(nodeId);
    }
});

network.on('doubleClick', function(properties) {
    if (document.getElementById('quickPlace').checked) {
        selectedNode = null;
        return;
    }
    if (properties.nodes.length > 0) {
        navigator.clipboard.writeText(properties.nodes[0]);
        return;
    }
    const nodeId = generateRealisticLabel();
    nodes.add({id: nodeId, label: nodeId, x: properties.pointer.canvas.x, y: properties.pointer.canvas.y});
    nodeTable[nodeId] = {'connections': [], 'packetCache': new Set(), 'routingTable': {}};
    onNodeAdd(nodeId);
});

network.on('dragging', (properties) => {
    if (properties.nodes.length == 0) {
        return;
    }
    const nodeId = properties.nodes[0];
    const pos = network.getPosition(nodeId);
    grid.update(nodeId, pos.x, pos.y);
    recomputeNodeConnections(nodeId, true);
});

network.on('beforeDrawing', function(ctx) {
    if (showGrid) {
        drawGrid(ctx);
    }
    if (selectedNode && document.getElementById('showRanges').checked) {
        drawRange(ctx);
    }
});

function drawGrid(ctx) {
    ctx.strokeStyle = '#878787';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const scale = network.getScale();
    const gridSize = CONNECTION_DISTANCE;
    
    // Get the visible area bounds
    const viewPosition = network.getViewPosition();
    const canvasElement = network.canvas.frame.canvas;
    const canvasWidth = canvasElement.width;
    const canvasHeight = canvasElement.height;
    
    // Calculate grid bounds based on view position and scale
    const startX = Math.floor((viewPosition.x - canvasWidth / (2 * scale)) / gridSize) * gridSize;
    const endX = Math.ceil((viewPosition.x + canvasWidth / (2 * scale)) / gridSize) * gridSize;
    const startY = Math.floor((viewPosition.y - canvasHeight / (2 * scale)) / gridSize) * gridSize;
    const endY = Math.ceil((viewPosition.y + canvasHeight / (2 * scale)) / gridSize) * gridSize;
    
    // Draw vertical lines
    for (let x = startX; x <= endX; x += gridSize) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
    }
    
    // Draw horizontal lines
    for (let y = startY; y <= endY; y += gridSize) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }
    ctx.stroke();
}

function drawRange(ctx) {
    ctx.strokeStyle = '#878787';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const position = network.getPosition(selectedNode);
    ctx.arc(position.x, position.y, CONNECTION_DISTANCE, 0, 2 * Math.PI);
    ctx.stroke();
}

document.getElementById('sendPacket').addEventListener('click', function() {
    if (selectedNode == null) {
        return;
    }
    onEdgeEngine.createEdgesTable();
    const packetId = generateRealisticLabel();
    var packetShift = generateRealisticLabel();
    let ttl = TTL;
    nodes.update({id: selectedNode, color: {background: '#97c2fc'}});
    for (let connection of nodeTable[selectedNode].connections) {
        var movingNode = {
            id: `${packetId}-${packetShift}-${ttl}-${selectedNode}`,
            label: packetId + `-${ttl}`,
            shape: 'dot',
            size: 6,
            color: {
                background: 'white',
                border: 'black'
            },
            font: {
                color: document.getElementById('darkMode').checked ? '#e0e0e0' : '#000'
            }
        };
        onEdgeEngine.createDotNode(movingNode, selectedNode, connection);
        nodeTable[selectedNode].packetCache.add(packetId);
        packetShift = generateRealisticLabel();
    }
});

document.getElementById('resetTTLColors').addEventListener('click', function() {
	let nodeUpdates = [];
	let edgeUpdates = [];
    for (let node of nodes.get()) {
		nodeUpdates.push({id: node.id, color: {background: '#97c2fc'}});
    }
    for (let edge of edges.get()) {
		edgeUpdates.push({id: edge.id, color: {color: '#2b7ce9', highlight: '#2b7ce9'}});
    }
	nodes.update(nodeUpdates);
	edges.update(edgeUpdates);
});

document.getElementById('updateInterval').addEventListener('change', function() {
    UPDATE_INTERVAL = parseInt(this.value);
});

document.getElementById('simSpeed').addEventListener('change', function() {
    const speed = parseFloat(this.value);
    if (!isFinite(speed) || speed <= 0) {
        return;
    }
    onEdgeEngine.setSimulationSpeed(speed);
});

document.getElementById('connectionDistance').addEventListener('change', function() {
    CONNECTION_DISTANCE = parseInt(this.value);
});

document.getElementById('dropPenalty').addEventListener('change', function() {
    DROP_PENALTY = parseFloat(this.value);
});

document.getElementById('ttl').addEventListener('change', function() {
    TTL = parseInt(this.value);
});

document.getElementById('maxConnections').addEventListener('change', function() {
    MAX_CONNECTIONS = parseInt(this.value);
});

document.getElementById('createRandomGraph').addEventListener('click', function() {
    document.getElementById('randomGraphModal').style.display = 'block';
});

document.getElementById('createRandomGraphConfirm').addEventListener('click', function() {
    const nodeCount = parseInt(document.getElementById('randomGraphNodes').value);
    const density = Math.max(1, parseInt(document.getElementById('randomGraphDensity').value) || 1);
    
    document.getElementById('randomGraphModal').style.display = 'none';
    if (!Number.isFinite(nodeCount) || nodeCount <= 0) {
        return;
    }

    // Reset existing graph
    nodes.clear();
    edges.clear();
    nodeTable = {};
    grid = new GridIndex(CONNECTION_DISTANCE);
    selectedNode = null;

    const cellSize = CONNECTION_DISTANCE;
    const cellsNeeded = Math.max(1, Math.ceil(nodeCount / density));
    const cols = Math.ceil(Math.sqrt(cellsNeeded));
    const rows = Math.ceil(cellsNeeded / cols);

    // Center the layout on the current view
    const center = network.getViewPosition();

    // Distribute node counts across cells (roughly even, no big clumps)
    const counts = new Array(cellsNeeded).fill(Math.floor(nodeCount / cellsNeeded));
    let remainder = nodeCount % cellsNeeded;
    const idxs = Array.from({ length: cellsNeeded }, (_, i) => i);
    for (let i = idxs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    for (let i = 0; i < remainder; i++) {
        counts[idxs[i]]++;
    }

    // Jitter within each cell so nodes are spread but remain near the cell center
    const jitter = cellSize * 0.45;

    let cellsPerFrame = 1;
    let runId;
    let nodesAdded = 0;
    let cellsFilled = 0;
    let lastNodeAdded;
    function addCells() {
        const end = Math.min(cellsFilled+cellsPerFrame, cellsNeeded);
        for (let i = cellsFilled; i < end; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const cx = center.x + (col - (cols - 1) / 2) * cellSize;
            const cy = center.y + (row - (rows - 1) / 2) * cellSize;

            for (let k = 0; k < counts[i]; k++) {
                const x = cx + (Math.random() * 2 - 1) * jitter;
                const y = cy + (Math.random() * 2 - 1) * jitter;

                const nodeId = generateRealisticLabel();
                nodes.add({ id: nodeId, label: nodeId, x, y });
                nodeTable[nodeId] = { 'connections': [], 'packetCache': new Set(), 'routingTable': {} };
                onNodeAdd(nodeId, true);
                lastNodeAdded = nodeId;
                nodesAdded++;
            }
            //recomputeNodeConnections(lastNodeAdded);
            cellsFilled++;
        }

        if (cellsFilled < cellsNeeded) {
            runId = requestAnimationFrame(addCells);
        } else {
            cancelAnimationFrame(runId);
            computeAllConnectionsFast();
        }
    }
    runId = requestAnimationFrame(addCells);
});

document.getElementById('darkMode').addEventListener('change', function() {
    if (this.checked) {
        document.getElementById('styleSheet').href = 'style-dark.css';
        localStorage.setItem('darkMode', 'true');
    } else {
        document.getElementById('styleSheet').href = 'style.css';
        localStorage.setItem('darkMode', 'false');
    }
});

document.getElementById('quickPacket').addEventListener('click', async function() {
    if (selectedNode == null) {
        return;
    }
    const packetId = generateRealisticLabel();
    var packetShift = generateRealisticLabel();
    let ttl = TTL;
    quickPacketRaf(selectedNode, `${packetId}-${packetShift}-${ttl}-${selectedNode}`, selectedNode);
});

document.getElementById('createRoutingTables').addEventListener('click', function() {
    let nodeCounter = 0;
    document.getElementById('routingProgressContainer').style.display = 'flex';
    document.getElementById('routingProgress').value = 0;
    document.getElementById('routingProgress').max = Object.keys(nodeTable).length;
    const interval = setInterval(() => {
        const packetId = generateRealisticLabel();
        var packetShift = generateRealisticLabel();
        let ttl = TTL;
        const nodeId = Object.keys(nodeTable)[nodeCounter];
        quickRoute(nodeId, `${packetId}-${packetShift}-${ttl}-${nodeId}`, nodeId);
        nodeCounter++;
        document.getElementById('routingProgress').value = nodeCounter;
        if (nodeCounter >= Object.keys(nodeTable).length) {
            clearInterval(interval);
            document.getElementById('routingProgressContainer').style.display = 'none';
            document.getElementById('routingProgress').value = 0;
            if (displayWarningWhenDone) {
                displayWarningWhenDone = false;
                document.getElementById('warningModal').style.display = 'block';
                document.getElementById('warningModalMessage').innerHTML = 'TTL hit zero while routing, some routes may be missing. If you experience issues, try increasing the TTL and routing again.';
                document.getElementById('warningModalCustomContent').innerHTML = '';
            } else {
                document.getElementById('successModal').style.display = 'block';
                document.getElementById('successModalMessage').innerHTML = 'Routing tables created successfully.';
            }
        }
    }, 10);
});

window.onload = function() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.getElementById('darkMode').checked = true;
        document.getElementById('styleSheet').href = 'style-dark.css';
    } else {
        document.getElementById('darkMode').checked = false;
        document.getElementById('styleSheet').href = 'style.css';
    }

    let consoleContainer = document.createElement('div');
    consoleContainer.id = 'consoleContainer';
    document.getElementById('simContainer').appendChild(consoleContainer);

    let openConsoleButton = document.createElement('button');
    openConsoleButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-terminal-icon lucide-terminal"><path d="M12 19h8"/><path d="m4 17 6-6-6-6"/></svg>';
    openConsoleButton.id = 'openConsole';
    openConsoleButton.addEventListener('click', function() {
        const consoleElement = document.getElementById('consoleContainer');
        const currentDisplay = window.getComputedStyle(consoleElement).display;
        consoleElement.style.display = currentDisplay === 'none' ? 'flex' : 'none';
    });

    let consoleInputContainer = document.createElement('div');
    consoleInputContainer.id = 'consoleInputContainer';
    consoleContainer.appendChild(consoleInputContainer);

    let consoleCarrot = document.createElement('pre');
    consoleCarrot.innerHTML = '>';
    consoleInputContainer.appendChild(consoleCarrot);

    let consoleInput = document.createElement('input');
    consoleInput.id = 'consoleInput';
    consoleInput.placeholder = 'Enter command';
    consoleInputContainer.appendChild(consoleInput);
    let consoleInputHistory = [];
    let consoleInputHistoryIndex = 0;
    // Handle Enter key for command execution
    consoleInput.addEventListener('keypress', async function(event) {
        if (event.key === 'Enter') {
            const command = consoleInput.value.trim();
            if (command) { // Only add non-empty commands to history
                consoleInputHistory.push(command);
            }
            consoleInputHistoryIndex = consoleInputHistory.length;
            
            const rootCommand = command.split(' ')[0];
            const args = command.split(' ')[1];
            
            switch (rootCommand) {
                case 'help':
                    switch (args) {
                        case 'routePacket':
                            consoleLog('Sends a packet from one specific node to another. Usage: routePacket [startNode]->[endNode]');
                            break;
                        case 'exit':
                            consoleLog('Exits the console');
                            break;
                        default:
                            consoleLog('Available commands: help, routePacket, exit');
                            break;
                    }
                    break;
                case 'routePacket':
                    if (!args) {
                        consoleLog('Usage: routePacket [startNode]->[endNode]');
                        break;
                    }
                    document.getElementById('resetTTLColors').click();
                    const packetInfo = `${generateRealisticLabel()}-${generateRealisticLabel()}-${TTL}-${args.split('->')[0]}-${args.split('->')[1]}`;
                    nodes.update({id: args.split('->')[0], color: {background: '#ff00d9'}});
                    nodes.update({id: args.split('->')[1], color: {background: '#ff00d9'}});
                    await routePacket(args.split('->')[0], args.split('->')[1], packetInfo, true);
                    break;
                case 'exit':
                    document.getElementById('consoleContainer').style.display = 'none';
                    break;
                default:
                    consoleLog(`Unknown command "${rootCommand}"`);
                    break;
            }
            consoleInput.value = '';
        }
    });

    // Handle arrow keys for history navigation
    consoleInput.addEventListener('keydown', function(event) {
        if (event.key === 'ArrowUp') {
            event.preventDefault(); // Prevent cursor movement
            if (consoleInputHistory.length === 0) return;
            
            if (consoleInputHistoryIndex > 0) {
                consoleInputHistoryIndex--;
            }
            consoleInput.value = consoleInputHistory[consoleInputHistoryIndex] || '';
        } else if (event.key === 'ArrowDown') {
            event.preventDefault(); // Prevent cursor movement
            if (consoleInputHistory.length === 0) return;
            
            consoleInputHistoryIndex++;
            if (consoleInputHistoryIndex >= consoleInputHistory.length) {
                consoleInputHistoryIndex = consoleInputHistory.length;
                consoleInput.value = ''; // Clear input when going beyond history
            } else {
                consoleInput.value = consoleInputHistory[consoleInputHistoryIndex] || '';
            }
        }
    });

    let consoleOutput = document.createElement('pre');
    consoleOutput.id = 'consoleOutput';
    consoleContainer.appendChild(consoleOutput);

    document.getElementById('simContainer').appendChild(openConsoleButton);

    // Ensure cancel button is hidden on load
    document.getElementById('cancelMarkNeighbor').style.display = 'none';
}

document.getElementById('cancelMarkNeighbor').addEventListener('click', function() {
    consoleLog('Cancelling mark neighbor...');
    cancelMarkNeighborRequested = true;

    // Clear any tracked intervals (legacy)
    for (let id of Array.from(markNeighborIntervals)) {
        clearInterval(id);
        markNeighborIntervals.delete(id);
    }
    // Clear any tracked RAFs
    for (let id of Array.from(markNeighborRafs)) {
        cancelAnimationFrame(id);
        markNeighborRafs.delete(id);
    }

    document.getElementById('cancelMarkNeighbor').style.display = 'none';
});

document.getElementById('showGrid').addEventListener('change', function() {
    showGrid = this.checked;
    network.redraw();
});

document.getElementById('showNodeUpdates').addEventListener('change', function() {
    console.log(this.checked);
    showUpdates = this.checked;
});

function consoleLog(message) {
    const consoleOutput = document.getElementById('consoleOutput');
    consoleOutput.innerHTML = `${message}`;
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}