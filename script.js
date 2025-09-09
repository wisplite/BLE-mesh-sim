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
// Track all active intervals for marking neighbors, and a cancel flag
var markNeighborIntervals = new Set();
var cancelMarkNeighborRequested = false;

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
    if (nodeTable[to].packetCache.includes(dot.id.split('-')[0])) {
        return;
    }
    // update color of receiving node for visualization
    nodeTable[to].packetCache.push(dot.id.split('-')[0]);
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

function quickPacket(startNode, packetInfo, fromNode) {
    const packetId = packetInfo.split('-')[0];
    const ttlStart = parseInt(packetInfo.split('-')[2]);
    const originNode = packetInfo.split('-')[3];

    const queue = [{ nodeId: startNode, ttl: ttlStart, from: fromNode }];

    while (queue.length > 0) {
        const { nodeId, ttl, from } = queue.shift();

        if (ttl < 0) {
            markNeighborsAsFailed(nodeId, from, packetId);
            continue;
        }
        if (nodeTable[nodeId]?.packetCache?.includes(packetId)) {
            continue;
        }

        nodeTable[nodeId].packetCache.push(packetId);

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
        if (nodeTable[nodeId]?.packetCache?.includes(packetId)) {
            continue;
        }

        nodeTable[nodeId].packetCache.push(packetId);
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

const markNeighborsAsFailed = (nodeId, from, packetId, visited = new Set()) => {
    if (cancelMarkNeighborRequested) {
        return;
    }
    if (visited.has(nodeId)) {
        return;
    }
    visited.add(nodeId);

    if (warningModalShown) {
        // enable walkthrough mode to prevent browser from freezing
        if (markNeighborIntervals.size === 0) {
            cancelMarkNeighborRequested = false;
        }
        document.getElementById('cancelMarkNeighbor').style.display = 'block';
        const neighborsSnapshot = (nodeTable[nodeId]?.connections?.slice()) || [];
        const neighborsLength = neighborsSnapshot.length;
        let currentIdx = 0;
        const intervalId = setInterval(() => {
            if (cancelMarkNeighborRequested) {
                clearInterval(intervalId);
                markNeighborIntervals.delete(intervalId);
                if (markNeighborIntervals.size === 0) {
                    document.getElementById('cancelMarkNeighbor').style.display = 'none';
                }
                return;
            }
            if (currentIdx < neighborsLength) {
                const neighbor = neighborsSnapshot[currentIdx];
                if (!visited.has(neighbor) && 
                    !nodeTable[neighbor]?.packetCache?.includes(packetId) && 
                    neighbor !== from) {
                    nodes.update({id: neighbor, color: {background: 'white'}});
                    edges.update({id: `${nodeId}->${neighbor}`, color: {color: 'white', highlight: '#97c2fc'}});
                    edges.update({id: `${neighbor}->${nodeId}`, color: {color: 'white', highlight: '#97c2fc'}});
                    markNeighborsAsFailed(neighbor, nodeId, packetId, visited);
                }
                currentIdx++;
            } else {
                clearInterval(intervalId);
                markNeighborIntervals.delete(intervalId);
                if (markNeighborIntervals.size === 0) {
                    document.getElementById('cancelMarkNeighbor').style.display = 'none';
                }
            }
        }, 1);
        markNeighborIntervals.add(intervalId);
        return;
    }

    const neighborsSnapshot = (nodeTable[nodeId]?.connections?.slice()) || [];
    for (let neighbor of neighborsSnapshot) {
        if (visited.has(neighbor)) {
            continue;
        }
        if (nodeTable[neighbor]?.packetCache?.includes(packetId)) {
            continue;
        }
        if (neighbor === from) {
            continue;
        }
        nodes.update({id: neighbor, color: {background: 'white'}});
        edges.update({id: `${nodeId}->${neighbor}`, color: {color: 'white', highlight: '#97c2fc'}});
        edges.update({id: `${neighbor}->${nodeId}`, color: {color: 'white', highlight: '#97c2fc'}});
        markNeighborsAsFailed(neighbor, nodeId, packetId, visited);
    }
}


function recomputeNodeConnections(nodeId) {
    const p = network.getPosition(nodeId);
    grid.update(nodeId, p.x, p.y);
}

// main event loop
function main() {
    const currentNodes = network.getPositions();
    const currentNodesKeys = Object.keys(currentNodes);
    for (let node1 of currentNodesKeys) {
        let neighbors = [];
        if (!nodeTable[node1]) {
            continue;
        }
        for (let node2 of currentNodesKeys) {
            if (!nodeTable[node2]) {
                continue;
            }
            if (node1 !== node2) {
                const node1data = currentNodes[node1];
                const node2data = currentNodes[node2];
                const distance = calculateDistance(node1data, node2data);
                if (distance < CONNECTION_DISTANCE) {
                    neighbors.push({'node': node2, 'distance': distanceToRSSI(distance), });
                } else {
                    edges.remove(`${node1}->${node2}`);
                    edges.remove(`${node2}->${node1}`);
                    const node1Idx = nodeTable[node1].connections.indexOf(node2);
                    if (node1Idx !== -1) {
                        nodeTable[node1].connections.splice(node1Idx, 1);
                    }
                    const node2Idx = nodeTable[node2].connections.indexOf(node1);
                    if (node2Idx !== -1) {
                        nodeTable[node2].connections.splice(node2Idx, 1);
                    }
                }
            }
        }
        const scores = [];
        for (let neighbor of neighbors) {
            if (!nodeTable[neighbor.node]) {
                continue;
            }
            let connectionScore = 0;
            let dropScore = 0;
            connectionScore += (100 + neighbor.distance);
            connectionScore += 100 / (nodeTable[neighbor.node].connections.length + 1);
            if (nodeTable[neighbor.node].connections.length == 0) {
                connectionScore += 10000;
            }
            if (nodeTable[neighbor.node].connections.length >= MAX_CONNECTIONS) {
                continue;
            }
            if (nodeTable[node1].connections.includes(neighbor.node)) {
                dropScore = connectionScore;
            }
            scores.push({'node': neighbor.node, 'score': connectionScore, 'dropScore': dropScore});
        }
        scores.sort((a, b) => b.score - a.score);
        const neighborMap = new Map(neighbors.map(n => [n.node, n]));
        const top3 = scores.slice(0, 3);
        for (let score of top3) {
            if (nodeTable[node1].connections.length >= MAX_CONNECTIONS) {
                let dropped = false;
                if (nodeTable[node1].connections.includes(score.node)) {
                    //console.log(`${score.node} is already connected; skipping drop attempt`);
                    continue;
                }
                for (let existingNode of [...nodeTable[node1].connections]) {
                    const neighborInfo = neighborMap.get(existingNode);
                    if (!neighborInfo) {
                        //console.log(`${existingNode} not a neighbor; skipping`);
                        continue;
                    }
                    let existingScore = 0;
                    existingScore += (100 + neighborInfo.distance);
                    existingScore += 100 / (nodeTable[existingNode].connections.length + 1);
                    if (nodeTable[existingNode].connections.length == 0) {
                        existingScore += 10000;
                    }
                    if (existingScore * DROP_PENALTY < score.score) {
                        //console.log(`Dropping ${existingNode} from ${node1} for better ${score.node}`);
                        const node1Idx = nodeTable[node1].connections.indexOf(existingNode);
                        if (node1Idx !== -1) {
                            nodeTable[node1].connections.splice(node1Idx, 1);
                        }
                        const node2Idx = nodeTable[existingNode].connections.indexOf(node1);
                        if (node2Idx !== -1) {
                            nodeTable[existingNode].connections.splice(node2Idx, 1);
                        }
                        edges.remove(`${node1}->${existingNode}`);
                        edges.remove(`${existingNode}->${node1}`);
                        dropped = true;
                        break;
                    } else {
                        //console.log(`Not dropping ${existingNode} from ${node1}; score ${existingScore.toFixed(2)} >= candidate ${score.score.toFixed(2)}`);
                        continue;
                    }
                }
                // still at capacity and nothing was dropped — skip adding this candidate
                if (nodeTable[node1].connections.length >= MAX_CONNECTIONS && !dropped) {
                    continue;
                }
            }
            if (nodeTable[node1].connections.includes(score.node) || nodeTable[score.node].connections.includes(node1)) {
                continue;
            }
            nodeTable[node1].connections.push(score.node);
            nodeTable[score.node].connections.push(node1);
            connectNodes(node1, score.node);
        }
    }
    setTimeout(main, UPDATE_INTERVAL);
}
main();

function onNodeAdd() {
    var nodeLength = Object.keys(nodeTable).length;
    if (nodeLength >= 200 && !warningModalShown) {
        warningModalShown = true;
        document.getElementById('warningModal').style.display = 'block';
        document.getElementById('warningModalMessage').innerHTML = 'Large network detected; simulation speed will be reduced.';
        document.getElementById('warningModalCustomContent').innerHTML = `<details><summary>What does this mean?</summary>
        <p>The simulation, by default, computes every node's connections 100 'times' per second. Due to the size of this network, this could cause the browser to freeze. To prevent this, the update interval (found in engine settings) is now locked to a multiple of the number of nodes. Additionally, when computing which nodes weren't reached after a packet is sent, the simulation will now walk through the network in steps rather than computing everything at once.</p>
        <br>
        <p>You may also want to consider using the quick packet feature, which will compute the packet propagation instantly rather than animating it. The animated nodes can cause lots of performance issues, especially on non-Chromium browsers.</p>`;
        document.getElementById('updateInterval').disabled = true;
        document.getElementById('updateInterval').value = nodeLength*2;
        UPDATE_INTERVAL = nodeLength*2;
        document.getElementById('simSpeed').value = 1;
        onEdgeEngine.setSimulationSpeed(1);
    } else if (nodeLength >= 200 && warningModalShown) {
        document.getElementById('updateInterval').value = nodeLength*2;
        UPDATE_INTERVAL = nodeLength*2;
    }
}

document.getElementById('addNode').addEventListener('click', function() {
    const nodeId = generateRealisticLabel();
    nodes.add({id: nodeId, label: nodeId});
    nodeTable[nodeId] = {'connections': [], 'packetCache': [], 'routingTable': {}};
    onNodeAdd();
});

network.on('click', function(properties) {
    if (properties.nodes.length > 0) {
        selectedNode = properties.nodes[0];
    } else {
        selectedNode = null;
    }
    if (document.getElementById('quickPlace').checked) {
        const nodeId = generateRealisticLabel();
        nodes.add({id: nodeId, label: nodeId, x: properties.pointer.canvas.x, y: properties.pointer.canvas.y});
        nodeTable[nodeId] = {'connections': [], 'packetCache': [], 'routingTable': {}};
        onNodeAdd();
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
    nodeTable[nodeId] = {'connections': [], 'packetCache': [], 'routingTable': {}};
    onNodeAdd();
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
        nodeTable[selectedNode].packetCache.push(packetId);
        packetShift = generateRealisticLabel();
    }
});

document.getElementById('resetTTLColors').addEventListener('click', function() {
    for (let node of nodes.get()) {
        nodes.update({id: node.id, color: {background: '#97c2fc'}});
    }

    for (let edge of edges.get()) {
        edges.update({id: edge.id, color: {color: '#2b7ce9', highlight: '#2b7ce9'}});
    }
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
    network.setOptions({
        nodes: {
            shape: 'box',
            physics: true,
        },
    });
    let nodeCounter = 0;
    const interval = setInterval(() => {
        const nodeId = generateRealisticLabel();
        nodes.add({id: nodeId, label: nodeId, x: Math.random() * 1000, y: Math.random() * 1000});
        nodeTable[nodeId] = {'connections': [], 'packetCache': [], 'routingTable': {}};
        onNodeAdd();
        nodeCounter++;
        if (nodeCounter >= nodeCount) {
            clearInterval(interval);
            setTimeout(() => {
                network.setOptions({
                    nodes: {
                        shape: 'box',
                        physics: false,
                    }
                });
            }, 2000);
        }
    }, 10);
    document.getElementById('randomGraphModal').style.display = 'none';
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
    quickPacket(selectedNode, `${packetId}-${packetShift}-${ttl}-${selectedNode}`, selectedNode);
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
    // Clear any tracked intervals
    for (let id of Array.from(markNeighborIntervals)) {
        clearInterval(id);
        markNeighborIntervals.delete(id);
    }
    document.getElementById('cancelMarkNeighbor').style.display = 'none';
});

document.getElementById('showGrid').addEventListener('change', function() {
    showGrid = this.checked;
    network.redraw();
});

function consoleLog(message) {
    const consoleOutput = document.getElementById('consoleOutput');
    consoleOutput.innerHTML = `${message}`;
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}