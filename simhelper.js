function generateRealisticLabel() {
    return crypto.randomUUID().substring(0, 8);
}

function calculateDistance(node1, node2) {
    return Math.sqrt((node1.x - node2.x) ** 2 + (node1.y - node2.y) ** 2);
}