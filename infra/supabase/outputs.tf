# V2 orun_supabase_database contract outputs.
# See spec/v2/07-provisioning-and-operations.md for canonical definitions.
#
# Sensitive outputs are marked sensitive = true so Terraform redacts them in
# plan/apply logs. Workflows must not print these values to logs or artifacts.

output "supabase_project_ref" {
  description = "Supabase project reference (project ID)"
  value       = supabase_project.main.id
}

output "supabase_project_url" {
  description = "Supabase API URL used by dashboard auth and service discovery"
  value       = "https://${supabase_project.main.id}.supabase.co"
}

output "supabase_jwks_url" {
  description = "JWKS URL used by the Worker to verify Supabase Auth JWTs"
  value       = "https://${supabase_project.main.id}.supabase.co/auth/v1/.well-known/jwks.json"
}

output "postgres_host" {
  description = "Postgres hostname for Hyperdrive and direct connection config"
  value       = "db.${supabase_project.main.id}.supabase.co"
}

output "postgres_port" {
  description = "Postgres port"
  value       = 5432
}

output "postgres_database" {
  description = "Postgres database name"
  value       = "postgres"
}

output "postgres_user_secret_ref" {
  description = "Secret name/path that holds the Postgres username (typically 'postgres' for the project owner)"
  value       = "${var.organization_slug}/${var.environment}/postgres-user"
}

output "postgres_password_secret_ref" {
  description = "Secret name/path that holds the Postgres password"
  value       = var.database_password_secret_ref
  sensitive   = true
}

output "database_url_secret_ref" {
  description = "Secret name/path that holds the direct Postgres URL (migration jobs only — not for Worker runtime)"
  value       = "${var.organization_slug}/${var.environment}/database-url"
  sensitive   = true
}

output "hyperdrive_database_url_secret_ref" {
  description = "Secret name/path used to create/update Cloudflare Hyperdrive (deferred to Worker integration task)"
  value       = "${var.organization_slug}/${var.environment}/hyperdrive-database-url"
  sensitive   = true
}
