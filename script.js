var UPDATE_INTERVAL = 10;
var CONNECTION_DISTANCE = 250;
var DROP_PENALTY = 1.2;
var TTL = 5;
var MAX_OUTGOING_CONNECTIONS = 3;
var MAX_INCOMING_CONNECTIONS = 3;
var warningModalShown = false;

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
onEdgeEngine.setArrivalCallback(({ from, to, dot }) => {
    if (nodeTable[to].packetCache.includes(dot.id.split('-')[0])) {
        return;
    }
    // update color of receiving node for visualization
    nodeTable[to].packetCache.push(dot.id.split('-')[0]);
    var packetId = dot.id.split('-')[0];
    var ttl = parseInt(dot.id.split('-')[2]); 
    ttl--;
    if (document.getElementById('showTTL').checked) {
        nodes.update({id: to, color: {background: smoothColorTransition('#eb4034', '#40eb34', 0, TTL, ttl)}});
    } else {
        nodes.update({id: to, color: {background: '#97c2fc'}});
    }
    if (ttl > 0) {
        const neighborsSnapshot = nodeTable[to].outgoing.slice();
        for (let neighbor of neighborsSnapshot) {
            if (neighbor === from) {
                continue;
            }
            console.log(`Sending packet ${packetId} from ${to} to ${neighbor}`);
            var packetShift = generateRealisticLabel();
            var movingNode = {
                id: `${packetId}-${packetShift}-${ttl}`,
                label: packetId + `-${ttl}`,
                shape: dot.shape,
                size: dot.size,
                color: dot.color,
            };
            onEdgeEngine.createDotNode(movingNode, to, neighbor);
        }
    } else {
        if (document.getElementById('showTTL').checked) {
            markNeighborsAsFailed(to, from, packetId);
        }
    }
});

const markNeighborsAsFailed = (nodeId, from, packetId, visited = new Set()) => {
    if (visited.has(nodeId)) {
        return;
    }
    visited.add(nodeId);

    const neighborsSnapshot = (nodeTable[nodeId]?.outgoing?.slice()) || [];
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
        markNeighborsAsFailed(neighbor, nodeId, packetId, visited);
    }
}

function nodeSelectUpdateHandler(properties) {
    // get containers
    const incomingTable = document.getElementById('incomingConnections');
    const outgoingTable = document.getElementById('outgoingConnections');
    
    // clear containers
    let connectionElements = incomingTable.querySelectorAll('.connectionElement');
    for (let connection of connectionElements) {
        connection.remove();
    }
    connectionElements = outgoingTable.querySelectorAll('.connectionElement');
    for (let connection of connectionElements) {
        connection.remove();
    }

    try {
        for (let connection of nodeTable[properties.nodes[0]].outgoing) {
            const connectionElement = document.createElement('div');
            connectionElement.classList.add('connectionElement');
            connectionElement.innerHTML = connection;
            outgoingTable.appendChild(connectionElement);
        }
        for (let connection of nodeTable[properties.nodes[0]].incoming) {
            const connectionElement = document.createElement('div');
            connectionElement.classList.add('connectionElement');
            connectionElement.innerHTML = connection;
            incomingTable.appendChild(connectionElement);
        }
    } catch (error) {
        return;
    }
}

network.on('selectNode', function(properties) {
    selectedNode = properties.nodes[0];
    if (document.getElementById('showRanges').checked) {
        const centerPoint = network.getPosition(properties.nodes[0]);
        const centerPointDOM = network.canvasToDOM({x: centerPoint.x, y: centerPoint.y});
        const edgePointDOM = network.canvasToDOM({x: centerPoint.x + CONNECTION_DISTANCE, y: centerPoint.y});
        const radius = Math.abs(edgePointDOM.x - centerPointDOM.x);
        const rangeVis = document.createElement('div');
        rangeVis.style.position = 'absolute';
        rangeVis.style.top = (centerPointDOM.y - radius) + 'px';
        rangeVis.style.left = (centerPointDOM.x - radius) + 'px';
        rangeVis.style.width = radius * 2 + 'px';
        rangeVis.style.height = radius * 2 + 'px';
        rangeVis.classList.add('rangeVis');
        document.getElementById('simContainer').appendChild(rangeVis);
    } else {
        const rangeVis = document.querySelector('.rangeVis');
        if (rangeVis) {
            rangeVis.remove();
        }
    }
    nodeSelectUpdateHandler(properties);
});

network.on('dragging', function(properties) {
    if (properties.nodes.length > 0) {
        selectedNode = properties.nodes[0];
    }
    if (document.getElementById('showRanges').checked) {
        if (selectedNode != null) {
            const centerPoint = network.getPosition(selectedNode);
            const centerPointDOM = network.canvasToDOM({x: centerPoint.x, y: centerPoint.y});
            const edgePointDOM = network.canvasToDOM({x: centerPoint.x + CONNECTION_DISTANCE, y: centerPoint.y});
            const radius = Math.abs(edgePointDOM.x - centerPointDOM.x);
            const rangeVis = document.querySelector('.rangeVis');
            if (rangeVis) {
                rangeVis.style.top = (centerPointDOM.y - radius) + 'px';
                rangeVis.style.left = (centerPointDOM.x - radius) + 'px';
                rangeVis.style.width = radius * 2 + 'px';
                rangeVis.style.height = radius * 2 + 'px';
            } else {
                const rangeVis = document.createElement('div');
                rangeVis.style.position = 'absolute';
                rangeVis.style.top = (centerPointDOM.y - radius) + 'px';
                rangeVis.style.left = (centerPointDOM.x - radius) + 'px';
                rangeVis.style.width = radius * 2 + 'px';
                rangeVis.style.height = radius * 2 + 'px';
                rangeVis.classList.add('rangeVis');
                document.getElementById('simContainer').appendChild(rangeVis);
            }
        } else if (properties.nodes.length > 0) {
            selectedNode = properties.nodes[0];
            const centerPoint = network.getPosition(selectedNode);
            const centerPointDOM = network.canvasToDOM({x: centerPoint.x, y: centerPoint.y});
            const edgePointDOM = network.canvasToDOM({x: centerPoint.x + CONNECTION_DISTANCE, y: centerPoint.y});
            const radius = Math.abs(edgePointDOM.x - centerPointDOM.x);
            const rangeVis = document.querySelector('.rangeVis');
            if (rangeVis) {
                rangeVis.style.top = (centerPointDOM.y - radius) + 'px';
                rangeVis.style.left = (centerPointDOM.x - radius) + 'px';
                rangeVis.style.width = radius * 2 + 'px';
                rangeVis.style.height = radius * 2 + 'px';
            }
        }
    }
    nodeSelectUpdateHandler(properties);
});

network.on('zoom', function(properties) {
    if (document.getElementById('showRanges').checked) {
        if (selectedNode) {
            const centerPoint = network.getPosition(selectedNode);
            const centerPointDOM = network.canvasToDOM({x: centerPoint.x, y: centerPoint.y});
            const edgePointDOM = network.canvasToDOM({x: centerPoint.x + CONNECTION_DISTANCE, y: centerPoint.y});
            const radius = Math.abs(edgePointDOM.x - centerPointDOM.x);
            const rangeVis = document.querySelector('.rangeVis');
            if (rangeVis) {
                rangeVis.style.top = (centerPointDOM.y - radius) + 'px';
                rangeVis.style.left = (centerPointDOM.x - radius) + 'px';
                rangeVis.style.width = radius * 2 + 'px';
                rangeVis.style.height = radius * 2 + 'px';
            }
        }
    }
    nodeSelectUpdateHandler(properties);
});

network.on('deselectNode', function(properties) {
    selectedNode = null;
    const rangeVis = document.querySelector('.rangeVis');
    if (rangeVis) {
        rangeVis.remove();
    }
    nodeSelectUpdateHandler(properties);
});

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
                    const outIdx = nodeTable[node1].outgoing.indexOf(node2);
                    if (outIdx !== -1) {
                        nodeTable[node1].outgoing.splice(outIdx, 1);
                    }
                    const inIdx = nodeTable[node2].incoming.indexOf(node1);
                    if (inIdx !== -1) {
                        nodeTable[node2].incoming.splice(inIdx, 1);
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
            connectionScore += 100 / (nodeTable[neighbor.node].incoming.length + 1);
            if (nodeTable[neighbor.node].incoming.length == 0) {
                connectionScore += 10000;
            }
            if (nodeTable[neighbor.node].incoming.length >= MAX_INCOMING_CONNECTIONS) {
                continue;
            }
            if (nodeTable[node1].outgoing.includes(neighbor.node)) {
                dropScore = connectionScore;
            }
            scores.push({'node': neighbor.node, 'score': connectionScore, 'dropScore': dropScore});
        }
        scores.sort((a, b) => b.score - a.score);
        const neighborMap = new Map(neighbors.map(n => [n.node, n]));
        const top3 = scores.slice(0, 3);
        for (let score of top3) {
            if (nodeTable[node1].outgoing.length >= MAX_OUTGOING_CONNECTIONS) {
                let dropped = false;
                if (nodeTable[node1].outgoing.includes(score.node)) {
                    //console.log(`${score.node} is already in outgoing; skipping drop attempt`);
                    continue;
                }
                for (let existingNode of [...nodeTable[node1].outgoing]) {
                    const neighborInfo = neighborMap.get(existingNode);
                    if (!neighborInfo) {
                        //console.log(`${existingNode} not a neighbor; skipping`);
                        continue;
                    }
                    let existingScore = 0;
                    existingScore += (100 + neighborInfo.distance);
                    existingScore += 100 / (nodeTable[existingNode].incoming.length + 1);
                    if (nodeTable[existingNode].incoming.length == 0) {
                        existingScore += 10000;
                    }
                    if (existingScore * DROP_PENALTY < score.score) {
                        //console.log(`Dropping ${existingNode} from ${node1} for better ${score.node}`);
                        const outIdx = nodeTable[node1].outgoing.indexOf(existingNode);
                        if (outIdx !== -1) {
                            nodeTable[node1].outgoing.splice(outIdx, 1);
                        }
                        const inIdx = nodeTable[existingNode].incoming.indexOf(node1);
                        if (inIdx !== -1) {
                            nodeTable[existingNode].incoming.splice(inIdx, 1);
                        }
                        edges.remove(`${node1}->${existingNode}`);
                        dropped = true;
                        break;
                    } else {
                        //console.log(`Not dropping ${existingNode} from ${node1}; score ${existingScore.toFixed(2)} >= candidate ${score.score.toFixed(2)}`);
                        continue;
                    }
                }
                // still at capacity and nothing was dropped — skip adding this candidate
                if (nodeTable[node1].outgoing.length >= MAX_OUTGOING_CONNECTIONS && !dropped) {
                    continue;
                }
            }
            if (nodeTable[node1].outgoing.includes(score.node) || nodeTable[score.node].incoming.includes(node1)) {
                continue;
            }
            nodeTable[node1].outgoing.push(score.node);
            nodeTable[score.node].incoming.push(node1);
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
    nodeTable[nodeId] = {'incoming': [], 'outgoing': [], 'packetCache': []};
    onNodeAdd();
});

network.on('click', function(properties) {
    if (properties.nodes.length > 0) {
        return;
    }
    if (document.getElementById('quickPlace').checked) {
        const nodeId = generateRealisticLabel();
        nodes.add({id: nodeId, label: nodeId, x: properties.pointer.canvas.x, y: properties.pointer.canvas.y});
        nodeTable[nodeId] = {'incoming': [], 'outgoing': [], 'packetCache': []};
        onNodeAdd();
    }
});

network.on('doubleClick', function(properties) {
    if (document.getElementById('quickPlace').checked) {
        return;
    }
    if (properties.nodes.length > 0) {
        return;
    }
    const nodeId = generateRealisticLabel();
    nodes.add({id: nodeId, label: nodeId, x: properties.pointer.canvas.x, y: properties.pointer.canvas.y});
    nodeTable[nodeId] = {'incoming': [], 'outgoing': [], 'packetCache': []};
    onNodeAdd();
});

document.getElementById('sendPacket').addEventListener('click', function() {
    if (selectedNode == null) {
        return;
    }
    onEdgeEngine.createEdgesTable();
    const packetId = generateRealisticLabel();
    var packetShift = generateRealisticLabel();
    let ttl = TTL;
    nodes.update({id: selectedNode, color: {background: '#97c2fc'}});
    for (let connection of nodeTable[selectedNode].outgoing) {
        var movingNode = {
            id: `${packetId}-${packetShift}-${ttl}`,
            label: packetId + `-${ttl}`,
            shape: 'dot',
            size: 6,
            color: {
                background: 'white',
                border: 'black'
            },
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

document.getElementById('maxOutgoingConnections').addEventListener('change', function() {
    MAX_OUTGOING_CONNECTIONS = parseInt(this.value);
});

document.getElementById('maxIncomingConnections').addEventListener('change', function() {
    MAX_INCOMING_CONNECTIONS = parseInt(this.value);
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
        nodes.add({id: nodeId, label: nodeId, x: Math.random() * 100, y: Math.random() * 100});
        nodeTable[nodeId] = {'incoming': [], 'outgoing': [], 'packetCache': []};
        onNodeAdd();
        nodeCounter++;
        if (nodeCounter >= nodeCount) {
            console.log('Node count reached');
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