terraform {
  required_version = ">= 1.7.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "azurerm" { features {} }

variable "location" { type = string, default = "centralindia" }
variable "environment" { type = string, default = "dev" }

resource "random_string" "suffix" { length = 6, special = false, upper = false }

resource "azurerm_resource_group" "driftops" {
  name     = "rg-driftops-${var.environment}"
  location = var.location
}

resource "azurerm_storage_account" "lake" {
  name                      = "stdriftops${random_string.suffix.result}"
  resource_group_name       = azurerm_resource_group.driftops.name
  location                  = azurerm_resource_group.driftops.location
  account_tier              = "Standard"
  account_replication_type  = "LRS"
  is_hns_enabled            = true
  min_tls_version           = "TLS1_2"
  shared_access_key_enabled = false
  blob_properties { versioning_enabled = true }
  tags = { project = "driftops", environment = var.environment, ttl = "ephemeral-demo" }
}

resource "azurerm_storage_data_lake_gen2_filesystem" "lake" {
  name               = "lake"
  storage_account_id = azurerm_storage_account.lake.id
}

resource "azurerm_eventhub_namespace" "stream" {
  name                 = "evhns-driftops-${random_string.suffix.result}"
  location             = azurerm_resource_group.driftops.location
  resource_group_name  = azurerm_resource_group.driftops.name
  sku                  = "Standard"
  capacity             = 1
  auto_inflate_enabled = false
}

resource "azurerm_eventhub" "customer_events" {
  name              = "customer-events"
  namespace_id      = azurerm_eventhub_namespace.stream.id
  partition_count   = 2
  message_retention = 1
}

resource "azurerm_data_factory" "orchestrator" {
  name                   = "adf-driftops-${random_string.suffix.result}"
  location               = azurerm_resource_group.driftops.location
  resource_group_name    = azurerm_resource_group.driftops.name
  public_network_enabled = true
  identity { type = "SystemAssigned" }
}

resource "azurerm_databricks_workspace" "lakehouse" {
  name                        = "dbw-driftops-${var.environment}"
  resource_group_name         = azurerm_resource_group.driftops.name
  location                    = azurerm_resource_group.driftops.location
  sku                         = "standard"
  managed_resource_group_name = "rg-driftops-databricks-${var.environment}"
  tags = { project = "driftops", environment = var.environment, auto_terminate = "15m" }
}

resource "azurerm_log_analytics_workspace" "logs" {
  name                = "log-driftops-${random_string.suffix.result}"
  location            = azurerm_resource_group.driftops.location
  resource_group_name = azurerm_resource_group.driftops.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = 0.5
}

resource "azurerm_monitor_diagnostic_setting" "adf" {
  name                       = "adf-to-log-analytics"
  target_resource_id         = azurerm_data_factory.orchestrator.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs.id
  enabled_log { category = "PipelineRuns" }
  enabled_log { category = "ActivityRuns" }
  enabled_metric { category = "AllMetrics" }
}

resource "azurerm_role_assignment" "adf_lake" {
  scope                = azurerm_storage_account.lake.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_data_factory.orchestrator.identity[0].principal_id
}

output "resource_group" { value = azurerm_resource_group.driftops.name }
output "storage_account" { value = azurerm_storage_account.lake.name }
output "data_factory" { value = azurerm_data_factory.orchestrator.name }
output "databricks_workspace_url" { value = azurerm_databricks_workspace.lakehouse.workspace_url }
output "event_hub_namespace" { value = azurerm_eventhub_namespace.stream.name }
output "event_hub_name" { value = azurerm_eventhub.customer_events.name }
output "log_analytics_workspace" { value = azurerm_log_analytics_workspace.logs.name }
