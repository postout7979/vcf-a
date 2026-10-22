from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    vcf_automation_base_url: str = "https://vcfa.example.local"
    vcf_automation_username: str = ""
    vcf_automation_password: str = ""
    vcf_automation_domain: str = "System Domain"
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
