terraform {
  required_version = ">= 1.5"

  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
  }

  # Remote state is required before applying to any shared environment.
  # Local state is acceptable only for disposable local experimentation
  # and is excluded from git by infra/supabase/.gitignore.
  #
  # Uncomment and configure the appropriate backend for staging/production:
  #
  # backend "s3" {
  #   bucket         = "orun-terraform-state"
  #   key            = "supabase/<environment>/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "orun-terraform-locks"
  # }
  #
  # Or, if using a Tactonic-approved backend, replace with the relevant block.
}
