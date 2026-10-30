// Computes a nested-dissection node order for CCH with RoutingKit's inertial flow.
//
// Input (little-endian): "CCHIN1\0\0", u32 node_count, u32 edge_count,
//   i32 lat_microdeg[node_count], i32 lon_microdeg[node_count],
//   u32 tail[edge_count], u32 head[edge_count]   (each undirected pair once)
// Output: u32 order[node_count], where order[rank] = node (RoutingKit's convention).
// Exits non-zero unless the output is a permutation of 0..node_count-1.
#include <routingkit/nested_dissection.h>

#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <vector>

namespace {

template <typename T>
void read_array(std::ifstream& in, std::vector<T>& out, std::uint32_t count) {
    out.resize(count);
    in.read(reinterpret_cast<char*>(out.data()), static_cast<std::streamsize>(count) * sizeof(T));
    if (!in) throw std::runtime_error("truncated input");
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 3) {
        std::cerr << "usage: cch_order INPUT.bin OUTPUT.bin\n";
        return 2;
    }
    try {
        std::ifstream in(argv[1], std::ios::binary);
        char magic[8];
        in.read(magic, 8);
        if (!in || std::memcmp(magic, "CCHIN1\0\0", 8) != 0) throw std::runtime_error("bad magic");
        std::uint32_t node_count = 0, edge_count = 0;
        in.read(reinterpret_cast<char*>(&node_count), 4);
        in.read(reinterpret_cast<char*>(&edge_count), 4);
        std::vector<std::int32_t> lat_micro, lon_micro;
        std::vector<unsigned> tail, head;
        read_array(in, lat_micro, node_count);
        read_array(in, lon_micro, node_count);
        read_array(in, tail, edge_count);
        read_array(in, head, edge_count);
        std::vector<float> lat(node_count), lon(node_count);
        for (std::uint32_t i = 0; i < node_count; ++i) {
            lat[i] = static_cast<float>(lat_micro[i] / 1e6);
            lon[i] = static_cast<float>(lon_micro[i] / 1e6);
        }
        for (std::uint32_t i = 0; i < edge_count; ++i)
            if (tail[i] >= node_count || head[i] >= node_count) throw std::runtime_error("edge endpoint out of range");

        std::vector<unsigned> order = RoutingKit::compute_nested_node_dissection_order_using_inertial_flow(
            node_count, tail, head, lat, lon);

        std::vector<char> seen(node_count, 0);
        if (order.size() != node_count) throw std::runtime_error("order has wrong length");
        for (unsigned v : order) {
            if (v >= node_count || seen[v]) throw std::runtime_error("order is not a permutation");
            seen[v] = 1;
        }
        std::ofstream out(argv[2], std::ios::binary);
        out.write(reinterpret_cast<const char*>(order.data()), static_cast<std::streamsize>(order.size()) * 4);
        if (!out) throw std::runtime_error("write failed");
        std::cerr << "order: " << node_count << " nodes, " << edge_count << " undirected edges\n";
    } catch (const std::exception& e) {
        std::cerr << "cch_order: " << e.what() << "\n";
        return 1;
    }
    return 0;
}
