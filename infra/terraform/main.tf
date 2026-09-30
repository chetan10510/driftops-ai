terraform {
  required_version = ">= 1.7.0"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
}

variable "project_id" { type = string }
variable "region" { type = string, default = "us-central1" }

provider "google" { project = var.project_id, region = var.region }

resource "google_pubsub_topic" "customer_events" {
  name                       = "customer-events"
  message_retention_duration = "604800s"
  schema_settings { schema = google_pubsub_schema.customer_event.id, encoding = "JSON" }
}

resource "google_pubsub_schema" "customer_event" {
  name       = "customer-event-v2"
  type       = "AVRO"
  definition = file("${path.module}/customer-event.avsc")
}

resource "google_bigquery_dataset" "driftops" {
  dataset_id                 = "driftops"
  location                   = "US"
  delete_contents_on_destroy = false
}
