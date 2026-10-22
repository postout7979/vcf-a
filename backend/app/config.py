from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    vcf_automation_base_url: str = "https://vcfa.example.local"
    vcf_automation_username: str = ""
    vcf_automation_password: str = ""
    # Provider plane: user@<provider org> + password, or a provider API token
    vcf_provider_org_name: str = "system"
    vcf_provider_refresh_token: str = ""
    # Org plane: per-org API (refresh) tokens as JSON {"org-name": "token"},
    # and an optional default token used for orgs not listed in the map.
    vcf_org_tokens: str = ""
    # Optional: comma-separated org names to sync (default: every org the provider sees)
    vcf_org_allowlist: str = ""
    # Optional: override the OIDC relying party clientId used for provider->org exchange
    vcf_relying_party_client_id: str = ""
    vcf_automation_refresh_token: str = ""
    vcf_automation_project_id: str = ""
    vcf_verify_tls: bool = True

    sync_interval_minutes: int = 60

    database_url: str = "sqlite:///./vcf_portal.db"

    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
