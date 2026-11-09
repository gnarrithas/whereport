import json
from urllib.request import urlretrieve

url = (
    "https://raw.githubusercontent.com/"
    "tjaffee99/flights/main/data/flights.json"
)

urlretrieve(url, "flights.json")

with open("flights.json", encoding="utf-8") as f:
    data = json.load(f)

airports = data["airports"]["code"]
routes = data["routes"]

graph = {code: set() for code in airports}

for a, b in zip(routes["a"], routes["b"]):
    origin = airports[a]
    destination = airports[b]

    graph[origin].add(destination)
    graph[destination].add(origin)

graph = {
    code: sorted(destinations)
    for code, destinations in graph.items()
}

with open("routes.json", "w", encoding="utf-8") as f:
    json.dump(graph, f)

print("Dataset date:", data["built"])
print("OTP destinations:", graph["OTP"])
