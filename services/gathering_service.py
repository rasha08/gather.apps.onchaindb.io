"""
GatheringService - Business logic for money gathering operations.

Handles all OnChainDB interactions for gatherings and contributions.

Architecture:
- Gatherings are immutable after creation (no updates)
- Contributions are stored separately
- Stats (current_amount, contributor_count) come from materialized view
  that JOINs gatherings with contributions and aggregates
"""

import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from onchaindb import OnChainDBClient

logger = logging.getLogger(__name__)


class GatheringService:
    """Service for managing money gatherings and contributions."""

    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the gathering service.

        Args:
            config: Configuration dictionary with OnChainDB settings.
        """
        self.config = config
        self.client = OnChainDBClient(
            endpoint=config["ONCHAINDB_ENDPOINT"],
            app_id=config["ONCHAINDB_APP_ID"],
            app_key=config["ONCHAINDB_APP_KEY"],
        )
        self._log("GatheringService initialized")

    def _log(self, message: str) -> None:
        """Log a message with service prefix."""
        logger.info(f"[GatheringService] {message}")

    def _generate_id(self) -> str:
        """Generate a unique ID for gatherings/contributions."""
        return uuid.uuid4().hex[:12]

    def _now_iso(self) -> str:
        """Get current UTC timestamp in ISO format."""
        return datetime.now(timezone.utc).isoformat()

    # =========================================
    # GATHERING OPERATIONS
    # =========================================

    def create_gathering(
        self,
        title: str,
        description: str,
        goal_amount: int,
        ends_at: str,
        creator: str,
        payment_proof: Dict[str, Any],
        image_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a new money gathering.

        Args:
            title: Gathering title.
            description: Gathering description.
            goal_amount: Goal amount in utia.
            ends_at: End date/time in ISO format.
            creator: Creator's wallet address.
            payment_proof: Payment proof for the creation fee.
            image_url: Optional image URL.

        Returns:
            The created gathering record with blockchain info.
        """
        self._log(f"Creating gathering: {title} by {creator}")

        gathering_id = self._generate_id()
        now = self._now_iso()

        # Gathering is immutable - no current_amount or contributor_count
        # Stats come from the materialized view
        gathering = {
            "id": gathering_id,
            "title": title,
            "description": description,
            "goal_amount": goal_amount,
            "creator": creator,
            "status": "active",
            "ends_at": ends_at,
            "created_at": now,
            "image_url": image_url or "",
        }

        result = self.client.store(
            collection="gatherings",
            data=[gathering],
            payment_proof=payment_proof,
        )

        self._log(f"Gathering created: {gathering_id}")

        return {
            **gathering,
            "current_amount": 0,
            "contributor_count": 0,
            "blockchain": result,
        }

    def get_gathering(self, gathering_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a single gathering by ID with computed stats.

        Args:
            gathering_id: The gathering ID.

        Returns:
            The gathering record with stats, or None if not found.
        """
        self._log(f"Getting gathering: {gathering_id}")

        gathering = self.client.find_unique("gatherings", {"id": gathering_id})

        if not gathering:
            return None

        # Get contributions for this gathering
        contributions = self.get_contributions(gathering_id)

        # Compute stats from contributions
        current_amount = sum(c.get("amount", 0) for c in contributions)
        contributor_count = len(contributions)

        # Check if goal reached
        status = gathering.get("status", "active")
        if status == "active" and current_amount >= gathering.get("goal_amount", 0):
            status = "completed"

        # Check if expired
        if status == "active":
            try:
                ends_at = datetime.fromisoformat(gathering["ends_at"].replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > ends_at:
                    status = "expired"
            except (KeyError, ValueError):
                pass

        return {
            **gathering,
            "current_amount": current_amount,
            "contributor_count": contributor_count,
            "status": status,
            "contributions": contributions,
        }

    def get_gatherings(
        self,
        status: Optional[str] = None,
        creator: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Get gatherings with computed stats.

        Uses the gatherings_with_stats view when available, falls back to
        computing stats from contributions.

        Args:
            status: Filter by status (active, completed, expired).
            creator: Filter by creator wallet address.
            limit: Maximum number of results.
            offset: Number of results to skip.

        Returns:
            List of gathering records with stats.
        """
        self._log(f"Getting gatherings (status={status}, creator={creator})")

        # Query base gatherings
        query = self.client.query_builder().collection("gatherings")

        if creator:
            query = query.where_field("creator").equals(creator)

        query = query.select_all().limit(limit * 5)  # Fetch extra to account for filtering

        response = query.execute()
        records = response.get("records", [])

        # Deduplicate by id (in case of any duplicates)
        seen_ids = set()
        unique_gatherings = []
        for r in records:
            gid = r.get("id")
            if gid and gid not in seen_ids:
                seen_ids.add(gid)
                unique_gatherings.append(r)

        # Compute stats for each gathering
        gatherings_with_stats = []
        for gathering in unique_gatherings:
            gathering_id = gathering.get("id")

            # Get contributions and compute stats
            contributions = self.get_contributions(gathering_id, limit=1000)
            current_amount = sum(c.get("amount", 0) for c in contributions)
            contributor_count = len(contributions)

            # Determine status
            g_status = gathering.get("status", "active")
            if g_status == "active":
                if current_amount >= gathering.get("goal_amount", 0):
                    g_status = "completed"
                else:
                    try:
                        ends_at = datetime.fromisoformat(gathering["ends_at"].replace("Z", "+00:00"))
                        if datetime.now(timezone.utc) > ends_at:
                            g_status = "expired"
                    except (KeyError, ValueError):
                        pass

            gatherings_with_stats.append({
                **gathering,
                "current_amount": current_amount,
                "contributor_count": contributor_count,
                "status": g_status,
            })

        # Filter by status
        if status:
            gatherings_with_stats = [g for g in gatherings_with_stats if g.get("status") == status]

        # Sort by created_at descending (newest first)
        gatherings_with_stats.sort(key=lambda g: g.get("created_at", ""), reverse=True)

        return gatherings_with_stats[:limit]

    def get_active_gatherings(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get all active gatherings."""
        return self.get_gatherings(status="active", limit=limit)

    def get_user_gatherings(
        self, creator: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get all gatherings created by a user."""
        return self.get_gatherings(creator=creator, limit=limit)

    # =========================================
    # CONTRIBUTION OPERATIONS
    # =========================================

    def contribute(
        self,
        gathering_id: str,
        amount: int,
        contributor: str,
        message: str,
        payment_proof: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Add a contribution to a gathering.

        Args:
            gathering_id: The gathering ID.
            amount: Contribution amount in utia.
            contributor: Contributor's wallet address.
            message: Optional message from contributor.
            payment_proof: Payment proof for the contribution.

        Returns:
            The contribution record with blockchain info.
        """
        self._log(f"Adding contribution to {gathering_id}: {amount} utia from {contributor}")

        # Get gathering to validate (uses find_unique for latest version)
        gathering = self.client.find_unique("gatherings", {"id": gathering_id})
        if not gathering:
            raise ValueError(f"Gathering not found: {gathering_id}")

        # Check base status
        if gathering.get("status") == "completed":
            raise ValueError("Gathering has already reached its goal")

        # Check if gathering has expired
        try:
            ends_at = datetime.fromisoformat(gathering["ends_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > ends_at:
                raise ValueError("Gathering has expired")
        except (KeyError, ValueError) as e:
            if "expired" in str(e).lower():
                raise

        contribution_id = self._generate_id()
        now = self._now_iso()

        contribution = {
            "id": contribution_id,
            "gathering_id": gathering_id,
            "contributor": contributor,
            "amount": amount,
            "message": message or "",
            "payment_tx_hash": payment_proof.get("payment_tx_hash", ""),
            "created_at": now,
        }

        result = self.client.store(
            collection="contributions",
            data=[contribution],
            payment_proof=payment_proof,
        )

        self._log(f"Contribution created: {contribution_id}")

        # No need to update gathering - stats computed from view/aggregation

        return {
            **contribution,
            "blockchain": result,
        }

    def get_contributions(
        self,
        gathering_id: str,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Get all contributions for a gathering.

        Args:
            gathering_id: The gathering ID.
            limit: Maximum number of results.

        Returns:
            List of contribution records.
        """
        self._log(f"Getting contributions for gathering: {gathering_id}")

        query = (
            self.client.query_builder()
            .collection("contributions")
            .where_field("gathering_id").equals(gathering_id)
            .select_all()
            .limit(limit)
        )

        response = query.execute()
        contributions = response.get("records", [])

        # Sort by created_at descending (newest first)
        contributions.sort(key=lambda c: c.get("created_at", ""), reverse=True)

        return contributions

    def get_user_contributions(
        self, contributor: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get all contributions by a user."""
        self._log(f"Getting contributions by user: {contributor}")

        query = (
            self.client.query_builder()
            .collection("contributions")
            .where_field("contributor").equals(contributor)
            .select_all()
            .limit(limit)
        )

        response = query.execute()
        contributions = response.get("records", [])

        # Sort by created_at descending
        contributions.sort(key=lambda c: c.get("created_at", ""), reverse=True)

        return contributions

    def get_recent_contributions(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent contributions across all gatherings."""
        self._log(f"Getting recent contributions (limit={limit})")

        query = (
            self.client.query_builder()
            .collection("contributions")
            .select_all()
            .limit(limit * 3)  # Fetch extra for deduplication
        )

        response = query.execute()
        contributions = response.get("records", [])

        # Sort by created_at descending
        contributions.sort(key=lambda c: c.get("created_at", ""), reverse=True)

        return contributions[:limit]

    # =========================================
    # STATISTICS
    # =========================================

    def get_stats(self) -> Dict[str, Any]:
        """Get platform statistics."""
        self._log("Getting platform stats")

        # Get all gatherings with computed stats
        all_gatherings = self.get_gatherings(limit=1000)

        # Calculate totals
        active_count = len([g for g in all_gatherings if g.get("status") == "active"])
        completed_count = len([g for g in all_gatherings if g.get("status") == "completed"])
        total_raised = sum(g.get("current_amount", 0) for g in all_gatherings)
        total_contributors = sum(g.get("contributor_count", 0) for g in all_gatherings)

        return {
            "active_gatherings": active_count,
            "total_gatherings": len(all_gatherings),
            "completed_gatherings": completed_count,
            "total_raised_utia": total_raised,
            "total_raised_tia": total_raised / 1_000_000,
            "total_contributors": total_contributors,
        }
