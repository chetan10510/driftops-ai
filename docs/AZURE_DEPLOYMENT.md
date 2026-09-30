# Azure deployment and cost controls

## Credit paths

1. **Azure for Students**: eligible higher-education students receive USD 100 for 12 months without a credit card. Academic status is required. https://learn.microsoft.com/azure/education-hub/find-ids
2. **Azure free account**: eligible new customers receive USD 200 for 30 days, then must explicitly move to pay-as-you-go to continue paid services. https://azure.microsoft.com/free/
3. **Databricks Free Edition**: use the no-cost Databricks learning environment for notebooks and Delta concepts when Azure subscription quota blocks a cluster. https://www.databricks.com/learn/free-edition
4. **AWS fallback**: new customers can receive USD 100 immediately and earn up to USD 100 more for six months. This project is Azure-native, so AWS is best kept for a separate comparison, not mixed into the architecture. https://aws.amazon.com/free/

Do not create duplicate accounts to bypass eligibility. Credit eligibility is identity and offer dependent.

## Cheapest credible deployment

Deploy the full stack only for a recorded demo or interview window:

- ADLS Gen2 with LRS and lifecycle deletion
- Event Hubs Standard with two partitions and one-day retention
- Databricks single-worker job cluster with 15-minute auto-termination
- ADF Copy and notebook activities; avoid Mapping Data Flows
- Log Analytics daily cap of 0.5 GB and 30-day retention
- No always-on SQL warehouse; use serverless or start it only for the demo

The Terraform defaults encode the small ephemeral shape and tag resources with `ttl=ephemeral-demo`.

## Deployment order

```powershell
az login
az account set --subscription "<subscription-id>"
cd infra\terraform
terraform init
terraform plan -out driftops.tfplan
terraform apply driftops.tfplan
```

Then import `azure/adf/customer360.pipeline.json`, deploy the Databricks bundle, and assign Unity Catalog permissions. Secrets belong in Azure Key Vault or Databricks secret scopes; never commit connection strings.

## Mandatory guardrails

1. Create a budget alert before Databricks resources.
2. Set cluster auto-termination to 15 minutes.
3. Use job clusters rather than an all-purpose cluster.
4. Run `terraform destroy` after the demo and confirm the resource group is empty.
5. Keep the public portfolio UI on its serverless host so recruiters do not consume Azure credits.
