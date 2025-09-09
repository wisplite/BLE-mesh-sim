function generateRealisticLabel() {
    return crypto.randomUUID().substring(0, 8);
}

function calculateDistance(node1, node2) {
    return Math.sqrt((node1.x - node2.x) ** 2 + (node1.y - node2.y) ** 2);
}

function connectNodes(node1, node2) {
    if (edges.get(`${node1}->${node2}`) || edges.get(`${node2}->${node1}`)) {
        return;
    }
    const edgeId = `${node1}->${node2}`;
    edges.add({
        id: edgeId,
        from: node1,
        to: node2,
    });
    edges.add({
        id: `${node2}->${node1}`,
        from: node2,
        to: node1,
    });
}

function distanceToRSSI(distance) {
    return -10 - 26 * Math.log10(distance);
}