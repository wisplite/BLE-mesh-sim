var UPDATE_INTERVAL = 10;
var CONNECTION_DISTANCE = 250;

var nodes = new vis.DataSet([
]);

var edges = new vis.DataSet([
]);

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

// main event loop
function main() {
    currentNodes = network.getPositions();
    currentNodesKeys = Object.keys(currentNodes);
    for (let node1 of currentNodesKeys) {
        for (let node2 of currentNodesKeys) {
            if (node1 !== node2) {
                const node1data = currentNodes[node1];
                const node2data = currentNodes[node2];
                const distance = calculateDistance(node1data, node2data);
                const edgeId = `${node1}->${node2}`;
                if (distance < CONNECTION_DISTANCE) {
                    if (!edges.get(edgeId)) {
                        edges.add({
                            id: edgeId,
                            from: node1,
                            to: node2,
                            smooth: { enabled: true, type: 'curvedCW', roundness: 0.1 }
                        });
                    }
                } else if (distance >= CONNECTION_DISTANCE) {
                    edges.remove(edgeId);
                }
            }
        }
    }
    setTimeout(main, UPDATE_INTERVAL);
}
main();

document.getElementById('addNode').addEventListener('click', function() {
    const nodeId = generateRealisticLabel();
    nodes.add({id: nodeId, label: nodeId});
});