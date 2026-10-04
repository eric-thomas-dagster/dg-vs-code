from dagster import resource

@resource
def bigquery_resource():
    return {
        "project": "your-gcp-project-id",
        "credentials": "path/to/your/credentials.json"
    }

