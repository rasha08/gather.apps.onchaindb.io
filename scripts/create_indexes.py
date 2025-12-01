#!/usr/bin/env python3
"""
Create OnChainDB indexes for the Money Gathering App

Run: python scripts/create_indexes.py
"""

import os
import sys
import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

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

    client = httpx.Client(
        base_url=ENDPOINT,
        headers={
            "Content-Type": "application/json",
            "X-App-Key": APP_KEY,
        },
        timeout=30.0,
    )

    # ============================================
    # GATHERINGS COLLECTION INDEXES
    # ============================================
    gathering_indexes = [
        {
            "name": "gatherings_id_unique",
            "collection": "gatherings",
            "field_name": "id",
            "index_type": "Hash",
            "unique_constraint": True,
            "store_values": True,
            "description": "Primary key - unique gathering ID",
        },
        {
            "name": "gatherings_creator_join",
            "collection": "gatherings",
            "field_name": "creator",
            "index_type": "Hash",
            "store_values": True,
            "description": "Find gatherings by creator wallet address",
        },
        {
            "name": "gatherings_status_filter",
            "collection": "gatherings",
            "field_name": "status",
            "index_type": "Hash",
            "store_values": True,
            "description": "Filter by active/completed/expired status",
        },
        {
            "name": "gatherings_created_at_sort",
            "collection": "gatherings",
            "field_name": "created_at",
            "index_type": "BTree",
            "store_values": True,
            "sort_enabled": True,
            "description": "Sort gatherings by creation date",
        },
        {
            "name": "gatherings_ends_at_sort",
            "collection": "gatherings",
            "field_name": "ends_at",
            "index_type": "BTree",
            "store_values": True,
            "sort_enabled": True,
            "description": "Sort by end date, find expired gatherings",
        },
        {
            "name": "gatherings_goal_amount_sort",
            "collection": "gatherings",
            "field_name": "goal_amount",
            "index_type": "BTree",
            "store_values": True,
            "sort_enabled": True,
            "description": "Sort by goal amount",
        },
    ]

    # ============================================
    # CONTRIBUTIONS COLLECTION INDEXES
    # ============================================
    contribution_indexes = [
        {
            "name": "contributions_id_unique",
            "collection": "contributions",
            "field_name": "id",
            "index_type": "Hash",
            "unique_constraint": True,
            "store_values": True,
            "description": "Primary key - unique contribution ID",
        },
        {
            "name": "contributions_gathering_id_join",
            "collection": "contributions",
            "field_name": "gathering_id",
            "index_type": "Hash",
            "store_values": True,
            "description": "JOIN field for gathering -> contributions relationship",
        },
        {
            "name": "contributions_contributor_join",
            "collection": "contributions",
            "field_name": "contributor",
            "index_type": "Hash",
            "store_values": True,
            "description": "Find contributions by contributor wallet address",
        },
        {
            "name": "contributions_amount_sort",
            "collection": "contributions",
            "field_name": "amount",
            "index_type": "BTree",
            "store_values": True,
            "sort_enabled": True,
            "description": "Sort contributions by amount",
        },
        {
            "name": "contributions_created_at_sort",
            "collection": "contributions",
            "field_name": "created_at",
            "index_type": "BTree",
            "store_values": True,
            "sort_enabled": True,
            "description": "Sort contributions by time",
        },
        {
            "name": "contributions_tx_hash_unique",
            "collection": "contributions",
            "field_name": "payment_tx_hash",
            "index_type": "Hash",
            "unique_constraint": True,
            "store_values": True,
            "description": "Track payment transactions (prevent duplicates)",
        },
    ]

    # ============================================
    # IMAGES COLLECTION INDEXES (Blob Storage)
    # ============================================
    image_indexes = [
        {
            "name": "images_blob_id_unique",
            "collection": "images",
            "field_name": "blob_id",
            "index_type": "Hash",
            "unique_constraint": True,
            "store_values": True,
            "description": "Unique blob identifier for retrieval",
        },
        {
            "name": "images_content_type_filter",
            "collection": "images",
            "field_name": "content_type",
            "index_type": "BTree",
            "store_values": True,
            "description": "Filter by MIME type (image/png, image/jpeg, etc.)",
        },
        {
            "name": "images_size_bytes_sort",
            "collection": "images",
            "field_name": "size_bytes",
            "index_type": "BTree",
            "store_values": True,
            "sort_enabled": True,
            "description": "File size for validation and sorting",
        },
        {
            "name": "images_uploaded_at_sort",
            "collection": "images",
            "field_name": "uploaded_at",
            "index_type": "BTree",
            "store_values": True,
            "sort_enabled": True,
            "description": "Timestamp for sorting by upload date",
        },
        {
            "name": "images_gathering_id_join",
            "collection": "images",
            "field_name": "gathering_id",
            "index_type": "Hash",
            "store_values": True,
            "description": "Link images to gatherings",
        },
    ]

    all_indexes = gathering_indexes + contribution_indexes + image_indexes
    created = 0
    skipped = 0
    failed = 0

    for index in all_indexes:
        try:
            print(f"Creating index: {index['name']}... ", end="", flush=True)

            response = client.post(
                f"/api/apps/{APP_ID}/indexes",
                json=index,
            )
            response.raise_for_status()

            print("OK")
            created += 1

        except httpx.HTTPStatusError as e:
            message = e.response.text

            # Check if index already exists
            if "already exists" in message or "duplicate" in message.lower():
                print("SKIP (already exists)")
                skipped += 1
            else:
                print(f"FAIL: {message}")
                failed += 1

        except Exception as e:
            print(f"FAIL: {str(e)}")
            failed += 1

    print()
    print("=" * 40)
    print("Index creation complete!")
    print(f"Created: {created}")
    print(f"Skipped: {skipped}")
    print(f"Failed: {failed}")
    print("=" * 40)

    # ============================================
    # CREATE MATERIALIZED VIEW: gatherings_with_stats
    # ============================================
    print()
    print("Creating materialized view: gatherings_with_stats...")

    view_config = {
        "name": "gatherings_with_stats",
        "source_collections": ["gatherings", "contributions"],
        "query": {
            "find": {},
            "select": {},
            # JOIN contributions to gatherings
            "contributions": {
                "resolve": {"gathering_id": "$data.id"},
                "model": "contributions",
                "many": True,
            },
        },
        # Aggregate contribution stats per gathering
        "group_by": ["id"],
        "aggregate": {
            "current_amount": {"$sum": "contributions.amount"},
            "contributor_count": {"$count": "contributions"},
        },
    }

    try:
        response = client.post(
            f"/apps/{APP_ID}/views",
            json=view_config,
        )
        response.raise_for_status()
        result = response.json()
        print(f"  View created! Ticket: {result.get('ticket_id', 'N/A')}")
    except httpx.HTTPStatusError as e:
        message = e.response.text
        if "already exists" in message or "duplicate" in message.lower():
            print("  View already exists (skipped)")
        else:
            print(f"  Failed to create view: {message}")
    except Exception as e:
        print(f"  Failed to create view: {str(e)}")

    print()
    print("Setup complete!")

    client.close()

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
