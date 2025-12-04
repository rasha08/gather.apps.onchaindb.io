#!/usr/bin/env python3
"""
Create OnChainDB indexes for the Money Gathering App using the new SDK schema API.

Run: python scripts/create_indexes.py
"""

import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add parent directory to path for local SDK development
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'db-client', 'sdk-python'))

from onchaindb import OnChainDBClient, SimpleCollectionSchema

ENDPOINT = os.getenv("ONCHAINDB_ENDPOINT", "http://localhost:9092")
APP_ID = os.getenv("ONCHAINDB_APP_ID", "")
APP_KEY = os.getenv("ONCHAINDB_APP_KEY", "")


def main():
    print("Creating indexes for TIA Gathering App...")
    print(f"Endpoint: {ENDPOINT}")
    print(f"App ID: {APP_ID}")
    print()

    if not APP_ID or not APP_KEY:
        print("ERROR: ONCHAINDB_APP_ID and ONCHAINDB_APP_KEY must be set")
        sys.exit(1)

    client = OnChainDBClient(
        endpoint=ENDPOINT,
        app_id=APP_ID,
        app_key=APP_KEY,
    )

    # ============================================
    # GATHERINGS COLLECTION SCHEMA
    # ============================================
    gatherings_schema: SimpleCollectionSchema = {
        "name": "gatherings",
        "fields": {
            "id": {"type": "string", "index": True, "unique": True, "indexType": "hash"},
            "creator": {"type": "string", "index": True, "indexType": "hash"},
            "status": {"type": "string", "index": True, "indexType": "hash"},
            "created_at": {"type": "date", "index": True},
            "ends_at": {"type": "date", "index": True},
            "goal_amount": {"type": "number", "index": True},
        },
        "use_base_fields": False,  # We define our own fields
    }

    # ============================================
    # CONTRIBUTIONS COLLECTION SCHEMA
    # ============================================
    contributions_schema: SimpleCollectionSchema = {
        "name": "contributions",
        "fields": {
            "id": {"type": "string", "index": True, "unique": True, "indexType": "hash"},
            "gathering_id": {"type": "string", "index": True, "indexType": "hash"},
            "contributor": {"type": "string", "index": True, "indexType": "hash"},
            "amount": {"type": "number", "index": True},
            "created_at": {"type": "date", "index": True},
            "payment_tx_hash": {"type": "string", "index": True, "indexType": "hash"},
        },
        "use_base_fields": False,
    }

    # ============================================
    # IMAGES COLLECTION SCHEMA (Blob Storage)
    # ============================================
    images_schema: SimpleCollectionSchema = {
        "name": "images",
        "fields": {
            "blob_id": {"type": "string", "index": True, "unique": True, "indexType": "hash"},
            "content_type": {"type": "string", "index": True},
            "size_bytes": {"type": "number", "index": True},
            "uploaded_at": {"type": "date", "index": True},
            "gathering_id": {"type": "string", "index": True, "indexType": "hash"},
        },
        "use_base_fields": False,
    }

    schemas = [
        ("gatherings", gatherings_schema),
        ("contributions", contributions_schema),
        ("images", images_schema),
    ]

    success_count = 0
    error_count = 0

    for name, schema in schemas:
        print(f"\n{'=' * 50}")
        print(f"Syncing collection: {name}")
        print(f"{'=' * 50}")

        try:
            # Use syncCollection to create/update indexes
            result = client.sync_collection(schema)

            print(f"  Success: {result.get('success', False)}")

            if result.get("created"):
                print(f"  Created indexes:")
                for idx in result["created"]:
                    print(f"    - {idx['field']} ({idx['type']})")

            if result.get("removed"):
                print(f"  Removed indexes:")
                for idx in result["removed"]:
                    print(f"    - {idx['field']} ({idx['type']})")

            if result.get("unchanged"):
                print(f"  Unchanged indexes: {len(result['unchanged'])}")

            if result.get("errors"):
                print(f"  Errors:")
                for err in result["errors"]:
                    print(f"    - {err}")
                error_count += 1
            else:
                success_count += 1

        except Exception as e:
            print(f"  FAILED: {str(e)}")
            error_count += 1

    # ============================================
    # CREATE MATERIALIZED VIEW: gatherings_with_stats
    # ============================================
    print(f"\n{'=' * 50}")
    print("Creating materialized view: gatherings_with_stats")
    print(f"{'=' * 50}")

    try:
        view = client.create_view(
            name="gatherings_with_stats",
            source_collections=["gatherings", "contributions"],
            query={
                "base": "gatherings",
                "join": {
                    "contributions": {
                        "on": {"gathering_id": "$data.id"},
                        "type": "left",
                    }
                },
                "aggregate": {
                    "current_amount": {"$sum": "contributions.amount"},
                    "contributor_count": {"$count": "contributions.id"},
                },
                "group_by": ["id"],
            }
        )
        print(f"  View created: {view.get('name', 'gatherings_with_stats')}")
        success_count += 1
    except Exception as e:
        error_msg = str(e)
        if "already exists" in error_msg.lower() or "duplicate" in error_msg.lower():
            print("  View already exists (skipped)")
        else:
            print(f"  FAILED: {error_msg}")
            # Try to refresh if it exists
            try:
                client.refresh_view("gatherings_with_stats")
                print("  Refreshed existing view")
            except:
                pass

    print()
    print("=" * 50)
    print("Setup complete!")
    print(f"  Collections synced: {success_count}")
    print(f"  Errors: {error_count}")
    print("=" * 50)

    if error_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
