var UPDATE_INTERVAL = 10;
var CONNECTION_DISTANCE = 250;

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

network.on('selectNode', function(properties) {
    if (document.getElementById('showRanges').checked) {
        selectedNode = properties.nodes[0];
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
    }
});

network.on('dragging', function(properties) {
    if (document.getElementById('showRanges').checked) {
        if (selectedNode != null) {
            if (properties.nodes.length > 0) {
                selectedNode = properties.nodes[0];
            }
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
});

network.on('deselectNode', function(properties) {
    selectedNode = null;
    if (document.getElementById('showRanges').checked) {
        const rangeVis = document.querySelector('.rangeVis');
        if (rangeVis) {
            rangeVis.remove();
        }
    }
});

// main event loop
function main() {
    currentNodes = network.getPositions();
    currentNodesKeys = Object.keys(currentNodes);
    for (let node1 of currentNodesKeys) {
        neighbors = [];
        for (let node2 of currentNodesKeys) {
            if (node1 !== node2) {
                const node1data = currentNodes[node1];
                const node2data = currentNodes[node2];
                const distance = calculateDistance(node1data, node2data);
                if (distance < CONNECTION_DISTANCE) {
                    neighbors.push({'node': node2, 'distance': distanceToRSSI(distance), });
                } else {
                    edges.remove(`${node1}->${node2}`);
                    nodeTable[node1].connections.splice(nodeTable[node1].connections.indexOf(node2), 1);
                }
            }
        }
        const scores = [];
        for (let neighbor of neighbors) {
            let connectionScore = 0;
            connectionScore += (100 + neighbor.distance);
            connectionScore += 100/nodeTable[neighbor.node].connections.length;
            if (nodeTable[neighbor.node].connections.length == 0) {
                connectionScore += 100;
            }
            if (nodeTable[neighbor.node].connections.length > 3) {
                continue;
            }
            scores.push({'node': neighbor.node, 'score': connectionScore});
        }
        scores.sort((a, b) => b.score - a.score);
        top3 = scores.slice(0, 3);
        for (let score of top3) {
            if (nodeTable[node1].connections.includes(score.node)) {
                continue;
            }
            nodeTable[node1].connections.push(score.node);
            connectNodes(node1, score.node);
        }
    }
    setTimeout(main, UPDATE_INTERVAL);
}
main();

document.getElementById('addNode').addEventListener('click', function() {
    const nodeId = generateRealisticLabel();
    nodes.add({id: nodeId, label: nodeId});
    nodeTable[nodeId] = {'connections': []};
});