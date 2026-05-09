# V2 orun_supabase_database contract inputs.
# See spec/v2/07-provisioning-and-operations.md for canonical definitions.

variable "environment" {
  description = "Environment name: dev, preview, staging, or prod"
  type        = string
  validation {
    condition     = contains(["dev", "preview", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, preview, staging, prod"
  }
}

variable "organization_slug" {
  description = "Owning product or company slug, used for naming and tags"
  type        = string
}

variable "supabase_organization_id" {
  description = "Supabase organization ID (from the Supabase dashboard), used by the provider resource"
  type        = string
}

variable "project_name" {
  description = "Supabase project display name"
  type        = string
}

variable "region" {
  description = "Supabase region for the environment"
  type        = string
  default     = "us-east-1"
}

variable "database_password_secret_ref" {
  description = "Name/path of the secret that holds the database password (not the value)"
  type        = string
}

variable "supabase_api_key" {
  description = "Supabase Management API token — sourced from SUPABASE_API_KEY in CI via TF_VAR_supabase_api_key"
  type        = string
  sensitive   = true
}

variable "enable_branching" {
  description = "Whether preview/branch databases are enabled for this environment"
  type        = bool
  default     = false
}

variable "allowed_cidr_blocks" {
  description = "Optional network allow list when supported by the Supabase plan/account"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Standard ownership, cost, and environment tags"
  type        = map(string)
  default     = {}
}
