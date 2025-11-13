/*
    Grid index for quickly looking up neighbor candidates.
*/
class GridIndex {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.cells = new Map();
        this.nodeCell = new Map();
    }
    keyFor(x, y) {
        const cx = Math.floor(x / this.cellSize);
        const cy = Math.floor(y / this.cellSize);
        return `${cx},${cy}`;
    }
    add(nodeId, x, y) {
        const key = this.keyFor(x, y);
        if (!this.cells.has(key)) {
            this.cells.set(key, new Set());
        }
        this.cells.get(key).add(nodeId);
        this.nodeCell.set(nodeId, key);
    }
    update(nodeId, x, y) {
        const newKey = this.keyFor(x, y);
        const oldKey = this.nodeCell.get(nodeId);
        if (oldKey == newKey) {
            return;
        }
        if (oldKey && this.cells.has(oldKey)) {
            this.cells.get(oldKey).delete(nodeId);
        }
        if (!this.cells.has(newKey)) {
            this.cells.set(newKey, new Set());
        }
        this.cells.get(newKey).add(nodeId);
        this.nodeCell.set(nodeId, newKey);
    }
    remove(nodeId) {
        const key = this.nodeCell.get(nodeId);
        if (key && this.cells.has(key)) {
            this.cells.get(key).delete(nodeId);
        }
        this.nodeCell.delete(nodeId);
    }
    getNeighborCandidates(x, y) {
        const cx = Math.floor(x / this.cellSize);
        const cy = Math.floor(y / this.cellSize);
        const output = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const key = `${cx + dx},${cy + dy}`;
                const bucket = this.cells.get(key);
                if (bucket) {
                    output.push(...bucket);
                }
            }
        }
        return output;
    }
}