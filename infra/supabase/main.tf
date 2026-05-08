# Supabase project/database provisioning for orun V2.
#
# Platform resources only. This component creates the Supabase project and
# exposes connection outputs. Application DDL (tables, indexes, policies) is
# owned by packages/db migrations and is never managed here.
#
# SUPABASE_API_KEY (GitHub Actions secret) is passed to this module via
# TF_VAR_supabase_api_key in the provisioning workflow. The Supabase provider
# maps that value to its access_token attribute internally. The canonical
# secret name in GitHub Actions remains SUPABASE_API_KEY throughout.

provider "supabase" {
  access_token = var.supabase_api_key
}

locals {
  common_tags = merge(var.tags, {
    environment = var.environment
    managed_by  = "terraform"
    component   = "orun_supabase_database"
    org         = var.organization_slug
  })
}

resource "supabase_project" "main" {
  organization_id   = var.supabase_organization_id
  name              = var.project_name
  region            = var.region
  database_password = var.database_password_secret_ref

  lifecycle {
    # Prevent accidental project destruction. Deletions require explicit
    # planning and must be approved by a human operator.
    prevent_destroy = true
    # Ignore database_password after initial creation to avoid inadvertent
    # password rotation. Explicit rotation belongs in a dedicated task.
    ignore_changes = [database_password]
  }
}
