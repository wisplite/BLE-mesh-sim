# BLE-mesh SIM

This is a simulation of a BLE-mesh network. It uses the [vis-network](https://visjs.github.io/vis-network/docs/network/) library to visualize the network itself, and a heavily modified version of [vis-network-moving-nodes-on-edges](https://github.com/delcourtfl/vis-network-moving-nodes-on-edges) to visualize the movement of packets through the network.

At this point the simulation is almost perfectly accurate, with the exception of packet origin tracking, which is being worked on.
You can:
- Add nodes to the network
- Topology will be updated automatically in the same way as the real network
- Configure a wide variety of simulation settings to see how they affect the network
- Create random networks with massive node counts (200+)!
- Send flood packets through the network and see how they travel through the network

When sending packets, the colors of each node will change to reflect the TTL of the packet. The more green a node is, the closer it was to the origin of the packet, the more red a node is, the further it is from the origin. Nodes that were unable to receive the packet will turn white (this is often due to low TTL on large networks).

I have also found that this simulation can vary wildly in performance depending on the machine and browser it's running on. Make sure your browser supports GPU acceleration, or else this will run very poorly with large networks. I have personally found that Chrome works the best for this by a huge margin, as much as I love Firefox.

You should be able to run this simulation by opening the `index.html` file in your browser, there's no fancy stack or anything, just pure HTML, CSS, and JavaScript.

You can also open it on GitHub Pages here: https://wisplite.github.io/BLE-mesh-sim/