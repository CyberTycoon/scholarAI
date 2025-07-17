import chromadb
from ollama import Client

# Initialize Chroma
client = chromadb.Client()
collection = client.create_collection("docs")

# Add a document
collection.add(
    documents=["AI agents can automate tasks like email sorting."],
    ids=["doc1"]
)

# Query Chroma
results = collection.query(query_texts=["What can AI agents do?"], n_results=1)
documents = results.get('documents')
if documents is not None and len(documents) > 0 and documents[0]:
    print("Chroma Results:", documents[0])
else:
    print("Chroma Results: No documents found.")

# Ask Ollama
ollama = Client(host='http://localhost:11434')
response = ollama.generate(model='tinyllama', prompt='What are AI agents?')
print("Ollama Response:", response['response'])