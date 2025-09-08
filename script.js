var UPDATE_INTERVAL = 10;
var CONNECTION_DISTANCE = 250;
var DROP_PENTALTY = 1.2;

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
    // Example: log arrival; dot removal is handled by engine
    // For flood behavior, you can spawn new dots here if needed
    console.log(`Dot ${dot.id} arrived from ${from} to ${to}`);
});

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
            if (nodeTable[neighbor.node].incoming.length >= 3) {
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
            if (nodeTable[node1].outgoing.length >= 3) {
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
                    if (existingScore * DROP_PENTALTY < score.score) {
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
                if (nodeTable[node1].outgoing.length >= 3 && !dropped) {
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

document.getElementById('addNode').addEventListener('click', function() {
    const nodeId = generateRealisticLabel();
    nodes.add({id: nodeId, label: nodeId});
    nodeTable[nodeId] = {'incoming': [], 'outgoing': []};
});

document.getElementById('sendPacket').addEventListener('click', function() {
    onEdgeEngine.createEdgesTable();
    onEdgeEngine.initMovement();
    const packetId = generateRealisticLabel();
    const packetShift = 0;
    for (let connection of nodeTable[selectedNode].outgoing) {
        var movingNode = {
            id: packetId + packetShift,
            label: packetId,
            shape: 'dot',
            size: 6,
            color: {
                background: 'white',
                border: 'black'
            },
        };
        onEdgeEngine.createDotNode(movingNode, selectedNode, connection);
        packetShift++;
    }
});