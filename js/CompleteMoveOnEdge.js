class CompleteNodeOnEdgeEngine {
    constructor(network, nodes, dotNodes, edges, forwTable) {
        this.network = network;

        // Overwrite the moveNodes() method for physics engine
        const originalFunction = this.network.physics.moveNodes;
        this.network.physics.moveNodes = function() {
            originalFunction.call(this);
            this.body.emitter.emit("physicsMoving");
        };

        this.nodes = nodes;
        this.edges = edges;
        this.dotNodes = dotNodes;
        this.movingDots = new Map();
        this.forwTable = forwTable;
        this.onArrival = null;


        this.linksByEdges = {};
        this.del_log_table = {};
        this.add_log_table = {};
        this.traces_table = {};
        this.edgesMoved = false;
        this.currentTime = 0;
        this.maxTime = 0;
        this.ratio_inc = 1; // in %
        this.time_delay = 10; // in ms

        this.timer = null;
        this.lastTime = 0;
        this.targetInterval = this.time_delay;
        this.speedMultiplier = 1;
        this.timeAccumulator = 0;
        this._movementInitialized = false;

        // Keep linksByEdges up-to-date for dynamic graph changes
        if (this.nodes && this.nodes.on) {
            this.nodes.on('add', (event, properties) => {
                if (!properties || !properties.items) { return; }
                properties.items.forEach((nodeId) => {
                    if (this.linksByEdges[nodeId] === undefined) {
                        this.linksByEdges[nodeId] = {};
                    }
                });
            });
            this.nodes.on('remove', (event, properties) => {
                if (!properties || !properties.oldData) { return; }
                properties.oldData.forEach((node) => {
                    // Remove row for this node
                    delete this.linksByEdges[node.id];
                    // Remove any incoming mappings pointing to this node
                    Object.keys(this.linksByEdges).forEach((fromId) => {
                        if (this.linksByEdges[fromId]) {
                            delete this.linksByEdges[fromId][node.id];
                        }
                    });
                });
            });
        }

        if (this.edges && this.edges.on) {
            this.edges.on('add', (event, properties) => {
                if (!properties || !properties.items) { return; }
                properties.items.forEach((edgeId) => {
                    const edge = this.edges.get(edgeId);
                    if (!edge) { return; }
                    if (this.linksByEdges[edge.from] === undefined) {
                        this.linksByEdges[edge.from] = {};
                    }
                    this.linksByEdges[edge.from][edge.to] = edge.id;
                    // Initialize cache container
                    if (edge.pointsArr === undefined) {
                        edge.pointsArr = {};
                    }
                });
            });
            this.edges.on('remove', (event, properties) => {
                if (!properties || !properties.oldData) { return; }
                properties.oldData.forEach((edge) => {
                    if (edge && this.linksByEdges[edge.from]) {
                        delete this.linksByEdges[edge.from][edge.to];
                    }
                });
            });
        }
    }

    setArrivalCallback(callback) {
        this.onArrival = callback;
    }

    /**
     * Adjust the simulation speed multiplier.
     * A value > 1 speeds up the simulation, 0 < value < 1 slows it down.
     * @param {number} multiplier
     */
    setSimulationSpeed(multiplier) {
        if (!isFinite(multiplier) || multiplier <= 0) {
            return;
        }
        this.speedMultiplier = multiplier;
        const minInterval = 1; // ms
        this.targetInterval = Math.max(minInterval, this.time_delay / this.speedMultiplier);
    }

    /**
     * Initializes the movement of the nodes on edges.
     */
    initMovement() {
        if (this._movementInitialized) {
            return;
        }
        this._movementInitialized = true;
        // Update the position of the dot node before the redraw event
        this.network.on('beforeDrawing', (ctx) => {
            if (this.edgesMoved) {
                this.edgesMoved = false;
                this.movingDots.forEach((dotNode) => {
                    this.fixDotOnEdge(dotNode);
                });
            }
        });

        this.network.on('afterDrawing', (ctx) => {
            this.drawMovingDots(ctx);
        });

        this.network.on('dragging', (params) => {
            if (params.edges.length <= 0) {
                return;
            }
            this.edgesMoved = true;
            params.edges.forEach((edgeId) => {
                const edgeItem = this.edges.get(edgeId);
                if (edgeItem) {
                    edgeItem.pointsArr = {};
                }
            });
        });

        this.network.on('physicsMoving', (params) => {
            this.edgesMoved = true;
            // Only clear cache for edges that have moving dots
            // instead of all edges - more efficient for large networks
            this.movingDots.forEach((dotNode) => {
                const edgeItem = this.edges.get(dotNode.edge);
                if (edgeItem) {
                    edgeItem.pointsArr = {};
                }
            });
        });

        this.network.on('click', (properties) => {
            var ids = properties.nodes;
            if (ids.length > 0) {
                console.log("x: " + properties.pointer.canvas.x + " y: " + properties.pointer.canvas.y);
                console.log(this.nodes.get(ids)[0]);
            } else {
                ids = properties.edges;
                if (ids.length > 0) {
                    console.log("x: " + properties.pointer.canvas.x + " y: " + properties.pointer.canvas.y);
                    console.log(this.edges.get(ids)[0]);
                } else {
                    console.log("x: " + properties.pointer.canvas.x + " y: " + properties.pointer.canvas.y);
                }
            }
        });

        this.timer = requestAnimationFrame(this.loop);
    }

    loop = (timestamp) => {
        if (this.lastTime === 0) {
            this.lastTime = timestamp;
        }
        const delta = timestamp - this.lastTime;
        this.lastTime = timestamp;

        this.timeAccumulator += delta * this.speedMultiplier;

        let steps = 0;
        const maxStepsPerFrame = 50;
        while (this.timeAccumulator >= this.time_delay && steps < maxStepsPerFrame) {
            this.eventProcess();
            this.timeAccumulator -= this.time_delay;
            steps++;
        }

        this.timer = requestAnimationFrame(this.loop);
    };

    /**
     * Processes the movement events and updates the nodes on edges accordingly.
     */
    eventProcess() {
        var ratio = this.ratio_inc * this.speedMultiplier;

        if (ratio < 0) {
            this.moveDot(ratio, this.currentTime);
            this.currentTime = this.currentTime + this.time_delay * Math.sign(this.ratio_inc) * this.speedMultiplier;
            this.replayManager(this.currentTime, true);

            this.maxTime = Math.max(this.maxTime, this.currentTime);

        } else {
            this.moveDot(ratio, this.currentTime);
            this.currentTime = this.currentTime + this.time_delay * Math.sign(this.ratio_inc) * this.speedMultiplier;
            this.replayManager(this.currentTime, false);

            this.maxTime = Math.max(this.maxTime, this.currentTime);
        }

        /*document.getElementById("currenttime").innerHTML = this.currentTime/1000;
        document.getElementById("ratio_inc").innerHTML = this.ratio_inc/100;
        document.getElementById("maxtime").innerHTML = this.maxTime/1000;*/
    }

    /**
     * Manages the replay of events at a specific time.
     * @param {number} time - The time to replay the events.
     * @param {boolean} isReplay - Indicates if it's a replay in forward or backward direction.
     */
    replayManager(time, isReplay) {
        if (isReplay) {
            if (this.del_log_table[time] !== undefined) {
                this.del_log_table[time].forEach((event) => {
                    this.traces_table[event[0].id].pop();
                    this.createDotNode(event[0], event[1], event[2], 100, time);
                });
                delete this.del_log_table[time];
            }
        } else {
            if (this.add_log_table[time] !== undefined) {
                this.add_log_table[time].forEach((event) => {
                    this.traces_table[event[0].id].pop();
                    this.createDotNode(event[0], event[1], event[2], 0, time);
                });
                delete this.add_log_table[time];
            }
        }
    }

    /**
     * Moves the dot nodes on the edges based on the current ratio.
     * @param {number} current_ratio - The current ratio of the movement.
     * @param {number} time - The current time of the movement.
     */
    moveDot(current_ratio, time) {
        if (this.movingDots.size <= 0) {
            return;
        }

        const dotsToRemove = [];

        this.movingDots.forEach((dotNode) => {
            dotNode.ratio += current_ratio;

            if (dotNode.ratio > 100) {
                this.traces_table[dotNode.id].push(dotNode.target);
                if (typeof this.onArrival === 'function') {
                    try {
                        this.onArrival({ from: dotNode.source, to: dotNode.target, dot: dotNode });
                    } catch (e) {}
                }
                dotsToRemove.push(dotNode);
                return;
            }

            if (dotNode.ratio < 0) {
                this.traces_table[dotNode.id].pop();
                const previousHop = this.traces_table[dotNode.id][this.traces_table[dotNode.id].length - 1];
                if (!this.updateDotNode(dotNode, previousHop, dotNode.source, 100 + dotNode.ratio)) {
                    dotsToRemove.push(dotNode);
                    return;
                }
            }

            this.fixDotOnEdge(dotNode);
        });

        dotsToRemove.forEach((dotNode) => {
            this.removeMovingDot(dotNode, time);
        });

        // Request canvas redraw without forcing full network re-render
        if (this.movingDots.size > 0) {
            this.network.canvas.body.emitter.emit("_requestRedraw");
        }
    }

    addMovingDot(dotNode, time = 0) {
        if (!dotNode || dotNode.id === undefined) {
            return;
        }

        if (!Array.isArray(this.traces_table[dotNode.id]) || this.traces_table[dotNode.id].length === 0) {
            this.traces_table[dotNode.id] = [dotNode.source];
        }

        this.movingDots.set(dotNode.id, dotNode);

        // Skip DataSet update - dots are drawn directly on canvas for better performance
        // if (this.dotNodes && typeof this.dotNodes.update === 'function') {
        //     this.dotNodes.update(dotNode);
        // }
    }

    removeMovingDot(dotNode, time = this.currentTime) {
        if (!dotNode || dotNode.id === undefined) {
            return;
        }

        this.movingDots.delete(dotNode.id);

        // Skip DataSet removal - dots are drawn directly on canvas for better performance
        // if (this.dotNodes && typeof this.dotNodes.remove === 'function') {
        //     this.dotNodes.remove(dotNode.id);
        // }

        const snapshot = {
            ...dotNode,
            color: dotNode.color ? { ...dotNode.color } : undefined,
            font: dotNode.font ? { ...dotNode.font } : undefined,
        };

        if (this.ratio_inc >= 0) {
            var removeEntry = this.del_log_table[time];
            if (removeEntry === undefined) {
                this.del_log_table[time] = [[snapshot, dotNode.source, dotNode.target]];
            } else {
                removeEntry.push([snapshot, dotNode.source, dotNode.target]);
            }
        } else {
            var addEntry = this.add_log_table[time];
            if (addEntry === undefined) {
                this.add_log_table[time] = [[snapshot, dotNode.source, dotNode.target]];
            } else {
                addEntry.push([snapshot, dotNode.source, dotNode.target]);
            }
        }
    }

    drawMovingDots(ctx) {
        if (!ctx || this.movingDots.size === 0) {
            return;
        }

        this.movingDots.forEach((dotNode) => {
            if (dotNode.x === undefined || dotNode.y === undefined) {
                return;
            }

            const radius = (dotNode.size || 10) / 2;
            const fillColor = dotNode.color && dotNode.color.background ? dotNode.color.background : '#97c2fc';
            const strokeColor = dotNode.color && dotNode.color.border ? dotNode.color.border : '#2b7ce9';
            const lineWidth = dotNode.color && dotNode.color.borderWidth ? dotNode.color.borderWidth : 2;

            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = lineWidth;
            ctx.strokeStyle = strokeColor;
            ctx.fillStyle = fillColor;

            if (dotNode.shape === 'box') {
                const half = radius;
                ctx.rect(dotNode.x - half, dotNode.y - half, half * 2, half * 2);
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.arc(dotNode.x, dotNode.y, radius, 0, 2 * Math.PI, false);
                ctx.fill();
                ctx.stroke();
            }
            ctx.closePath();

            if (dotNode.label) {
                const fontSize = dotNode.font && dotNode.font.size ? dotNode.font.size : 12;
                const fontFace = dotNode.font && dotNode.font.face ? dotNode.font.face : 'arial';
                ctx.font = `${fontSize}px ${fontFace}`;
                ctx.fillStyle = dotNode.font && dotNode.font.color ? dotNode.font.color : '#000';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(dotNode.label, dotNode.x, dotNode.y);
            }

            ctx.restore();
        });
    }

    /**
     * Fixes the position of the dot node on the edge.
     * @param {object} dotNode - The dot node object.
     */
    fixDotOnEdge(dotNode) {
        var edge = this.network.body.edges[dotNode.edge];
        // If the underlying edge no longer exists (dynamic removal), try to retarget or drop the dot
        if (edge === undefined) {
            var path = this.getEdgeConnectingNodes(dotNode.source, dotNode.target);
            if (path[0] === undefined) {
                // No longer a direct path; remove the moving dot gracefully
                this.removeMovingDot(dotNode);
                return;
            }
            dotNode.edge = path[0];
            dotNode.reversed = path[1];
            edge = this.network.body.edges[dotNode.edge];
            if (edge === undefined) {
                // Network body not updated yet; skip this frame
                return;
            }
        }

        var current_ratio = dotNode.reversed ? 100 - dotNode.ratio : dotNode.ratio;
        var datasetEdge = this.edges.get(edge.id);
        if (!datasetEdge) {
            // Edge was removed from DataSet; attempt to retarget
            var retryPath = this.getEdgeConnectingNodes(dotNode.source, dotNode.target);
            if (retryPath[0] === undefined) {
                this.removeMovingDot(dotNode);
                return;
            }
            dotNode.edge = retryPath[0];
            dotNode.reversed = retryPath[1];
            edge = this.network.body.edges[dotNode.edge];
            if (!edge) { return; }
            datasetEdge = this.edges.get(edge.id);
            if (!datasetEdge) { return; }
        }
        if (datasetEdge.pointsArr === undefined) {
            datasetEdge.pointsArr = {};
        }
        var edgePoint = datasetEdge.pointsArr[current_ratio];
        if (edgePoint === undefined) {
            if (!edge.edgeType || !edge.edgeType.getPoint) {
                return;
            }
            edgePoint = edge.edgeType.getPoint(current_ratio / 100);
            datasetEdge.pointsArr[current_ratio] = edgePoint;
        }
        dotNode.x = edgePoint.x;
        dotNode.y = edgePoint.y;
    }

    /**
    * Updates the dot node with new source, target, and ratio values.
    * @param {object} node - The dot node object.
    * @param {string} from - The source node ID.
    * @param {string} to - The target node ID.
    * @param {number} ratio - The ratio value.
    * @returns {boolean} - Indicates if the update was successful.
    */
    updateDotNode(node, from, to, ratio = 0) {
        if (to === undefined || from === undefined) {
            return false;
        }
        var path = this.getEdgeConnectingNodes(from, to);
        if (path[0] === undefined) {
            console.log("No edge between the two given nodes: " + from + ", " + to);
            return false;
        }
        Object.assign(node, { ratio: ratio, source: from, target: to, edge: path[0], reversed: path[1] });
        return true;
    }

    /**
    * Creates a new dot node and adds it to the network.
    * @param {object} node - The dot node object containing properties such as ID, label, shape, size, and color.
    * @param {string} from - The source node ID.
    * @param {string} to - The target node ID.
    * @param {number} init_ratio - The initial ratio value.
    * @param {number} time - The current time of the creation.
    */
    createDotNode(node, from, to, init_ratio = 0, time = 0) {
        var path = this.getEdgeConnectingNodes(from, to);
        if (path[0] === undefined) {
            console.log("No edge between the two given nodes: " + from + ", " + to);
            return;
        }

        var newDotNode = {
            id: node.id,
            label: node.label,
            shape: node.shape,
            edge: path[0],
            source: from,
            target: to,
            size: node.size,
            color: node.color,
            physics: false,
            group: 'movingdots',
            ratio: init_ratio,
            reversed: path[1],
            fixed: true,
            font: node.font,
        };

        var edge = this.network.body.edges[newDotNode.edge];
        var current_ratio = newDotNode.reversed ? 100 - newDotNode.ratio : newDotNode.ratio;
        var datasetEdge = this.edges.get(edge.id);
        if (!datasetEdge.pointsArr) {
            datasetEdge.pointsArr = {};
        }
        var edgePoint = datasetEdge.pointsArr[current_ratio];
        if (edgePoint === undefined) {
            edgePoint = edge.edgeType.getPoint(current_ratio / 100);
            datasetEdge.pointsArr[current_ratio] = edgePoint;
        }
        newDotNode.x = edgePoint.x;
        newDotNode.y = edgePoint.y;

        this.addMovingDot(newDotNode, time);
        // Canvas will redraw on next animation frame
    }

    /**
    * Creates the edges table for efficient edge lookup.
    */
    createEdgesTable() {
        this.nodes.forEach((node) => {
            this.linksByEdges[node.id] = this.linksByEdges[node.id] || {};
        });

        this.edges.forEach((edge) => {
            this.linksByEdges[edge.from][edge.to] = edge.id;
            edge.pointsArr = {};
        });
    }

    /**
    * Retrieves the edge connecting two nodes.
    * @param {string} nodeId1 - The first node ID.
    * @param {string} nodeId2 - The second node ID.
    * @returns {array} - An array containing the edge ID and a flag indicating if the edge is reversed.
    */
    getEdgeConnectingNodes(nodeId1, nodeId2) {
        var map1 = this.linksByEdges[nodeId1];
        var edgeId = map1 ? map1[nodeId2] : undefined;
        if (edgeId !== undefined) {
            return [edgeId, false];
        }
        var map2 = this.linksByEdges[nodeId2];
        edgeId = map2 ? map2[nodeId1] : undefined;
        if (edgeId !== undefined) {
            return [edgeId, true];
        }
        return [undefined, undefined];
    }

    // Timing control events

    stopProcess() {
        cancelAnimationFrame(this.timer);
    }

    runProcess() {
        cancelAnimationFrame(this.timer);
        this.timer = requestAnimationFrame(this.loop); 
    }

    forward() {
        this.ratio_inc = Math.abs(this.ratio_inc);
    }

    backward() {
        this.ratio_inc = -Math.abs(this.ratio_inc);
    }

    step() {
        this.eventProcess();
    }
}
  