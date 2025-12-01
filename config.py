"""
Application configuration for TIA Gathering App.

Loads settings from environment variables with sensible defaults.
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Config:
    """Base configuration."""

    # Application
    APP_NAME = os.getenv("APP_NAME", "TIA Gather")
    DEBUG = os.getenv("APP_DEBUG", "false").lower() == "true"
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")

    # OnChainDB
    ONCHAINDB_ENDPOINT = os.getenv("ONCHAINDB_ENDPOINT", "http://localhost:9092")
    ONCHAINDB_APP_ID = os.getenv("ONCHAINDB_APP_ID", "")
    ONCHAINDB_APP_KEY = os.getenv("ONCHAINDB_APP_KEY", "")

    # Celestia Network
    CELESTIA_CHAIN_ID = os.getenv("CELESTIA_CHAIN_ID", "mocha-4")
    CELESTIA_RPC = os.getenv("CELESTIA_RPC", "https://rpc-mocha.pops.one")
    CELESTIA_REST = os.getenv("CELESTIA_REST", "https://api-mocha.pops.one")
    BROKER_ADDRESS = os.getenv("BROKER_ADDRESS", "")

    # Pricing (in utia - micro TIA)
    # 1 TIA = 1,000,000 utia
    MIN_CONTRIBUTION_UTIA = int(os.getenv("MIN_CONTRIBUTION_UTIA", "100000"))  # 0.1 TIA
    CREATION_FEE_UTIA = int(os.getenv("CREATION_FEE_UTIA", "500000"))  # 0.5 TIA


class DevelopmentConfig(Config):
    """Development configuration."""

    DEBUG = True


class ProductionConfig(Config):
    """Production configuration."""

    DEBUG = False


# Select config based on environment
config_map = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}

environment = os.getenv("FLASK_ENV", "development")
AppConfig = config_map.get(environment, DevelopmentConfig)
