"""
TIA Gather - Money Gathering App on Celestia

Main Flask application with API routes.
"""

import logging
from flask import Flask, jsonify, request, render_template
import httpx

from config import AppConfig
from services import GatheringService

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if AppConfig.DEBUG else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config.from_object(AppConfig)

# Initialize services
gathering_service = GatheringService(
    {
        "ONCHAINDB_ENDPOINT": AppConfig.ONCHAINDB_ENDPOINT,
        "ONCHAINDB_APP_ID": AppConfig.ONCHAINDB_APP_ID,
        "ONCHAINDB_APP_KEY": AppConfig.ONCHAINDB_APP_KEY,
    }
)


# =========================================
# CORS Headers
# =========================================
@app.after_request
def add_cors_headers(response):
    """Add CORS headers to all responses."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


# =========================================
# FRONTEND ROUTES
# =========================================
@app.route("/")
def index():
    """Serve the main frontend."""
    return render_template("index.html")


@app.route("/g/<gathering_id>")
def gathering_page(gathering_id):
    """Serve the gathering detail page."""
    return render_template("index.html")


# =========================================
# API: CONFIG
# =========================================
@app.route("/api/config", methods=["GET"])
def get_config():
    """Get public configuration for frontend."""
    return jsonify(
        {
            "success": True,
            "config": {
                "app_name": AppConfig.APP_NAME,
                "chain_id": AppConfig.CELESTIA_CHAIN_ID,
                "rpc": AppConfig.CELESTIA_RPC,
                "rest": AppConfig.CELESTIA_REST,
                "broker_address": AppConfig.BROKER_ADDRESS,
                "min_contribution_utia": AppConfig.MIN_CONTRIBUTION_UTIA,
                "creation_fee_utia": AppConfig.CREATION_FEE_UTIA,
            },
        }
    )


# =========================================
# API: GATHERINGS
# =========================================
@app.route("/api/gatherings", methods=["GET"])
def get_gatherings():
    """Get list of gatherings."""
    try:
        status = request.args.get("status", "active")
        creator = request.args.get("creator")
        limit = min(int(request.args.get("limit", 50)), 100)
        offset = int(request.args.get("offset", 0))

        gatherings = gathering_service.get_gatherings(
            status=status if status != "all" else None,
            creator=creator,
            limit=limit,
            offset=offset,
        )

        return jsonify({"success": True, "gatherings": gatherings})

    except Exception as e:
        logger.error(f"Error getting gatherings: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/gatherings/<gathering_id>", methods=["GET"])
def get_gathering(gathering_id):
    """Get a single gathering with its contributions."""
    try:
        gathering = gathering_service.get_gathering(gathering_id)

        if not gathering:
            return jsonify({"success": False, "error": "Gathering not found"}), 404

        return jsonify({"success": True, "gathering": gathering})

    except Exception as e:
        logger.error(f"Error getting gathering {gathering_id}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/gatherings", methods=["POST"])
def create_gathering():
    """Create a new gathering.

    If payment_proof is not provided, returns 402 with required amount from pricing quote.
    """
    try:
        data = request.get_json()

        # Validate required fields (payment_proof is optional for quote)
        required = ["title", "description", "goal_amount", "ends_at", "creator"]
        for field in required:
            if field not in data:
                return jsonify({"success": False, "error": f"Missing field: {field}"}), 400

        payment_proof = data.get("payment_proof")

        # If no payment_proof, get pricing quote and return 402
        if not payment_proof or not payment_proof.get("payment_tx_hash"):
            # Calculate data size for pricing
            gathering_data = {
                "title": data["title"],
                "description": data["description"],
                "goal_amount": data["goal_amount"],
                "ends_at": data["ends_at"],
            }
            import json
            data_size = len(json.dumps(gathering_data))
            size_kb = max(1, (data_size + 1023) // 1024)

            # Get pricing quote from OnChainDB
            quote = gathering_service.client.get_pricing_quote(
                collection="gatherings",
                operation_type="write",
                size_kb=size_kb,
            )

            total_cost_tia = quote.get("total_cost_tia", quote.get("total_cost", 0))
            amount_utia = int(total_cost_tia * 1_000_000)

            return jsonify({
                "success": False,
                "error": "Payment required",
                "payment_required": {
                    "amount_utia": amount_utia,
                    "pay_to": AppConfig.BROKER_ADDRESS,
                    "description": f"Create gathering: {data['title'][:30]}",
                }
            }), 402

        gathering = gathering_service.create_gathering(
            title=data["title"],
            description=data["description"],
            goal_amount=int(data["goal_amount"]),
            ends_at=data["ends_at"],
            creator=data["creator"],
            payment_proof=payment_proof,
            image_url=data.get("image_url"),
        )

        return jsonify({"success": True, "gathering": gathering})

    except Exception as e:
        logger.error(f"Error creating gathering: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# =========================================
# API: CONTRIBUTIONS
# =========================================
@app.route("/api/gatherings/<gathering_id>/contribute", methods=["POST"])
def contribute(gathering_id):
    """Add a contribution to a gathering.

    If payment_proof is not provided, returns 402 with required amount from pricing quote.
    """
    try:
        data = request.get_json()

        # Validate required fields (payment_proof is optional for quote)
        required = ["amount", "contributor"]
        for field in required:
            if field not in data:
                return jsonify({"success": False, "error": f"Missing field: {field}"}), 400

        amount = int(data["amount"])
        payment_proof = data.get("payment_proof")

        # If no payment_proof, get pricing quote and return 402
        if not payment_proof or not payment_proof.get("payment_tx_hash"):
            # Calculate data size for pricing
            import json
            contribution_data = {
                "gathering_id": gathering_id,
                "amount": amount,
                "message": data.get("message", ""),
            }
            data_size = len(json.dumps(contribution_data))
            size_kb = max(1, (data_size + 1023) // 1024)

            # Get pricing quote from OnChainDB
            quote = gathering_service.client.get_pricing_quote(
                collection="contributions",
                operation_type="write",
                size_kb=size_kb,
            )

            total_cost_tia = quote.get("total_cost_tia", quote.get("total_cost", 0))
            storage_fee_utia = int(total_cost_tia * 1_000_000)

            return jsonify({
                "success": False,
                "error": "Payment required",
                "payment_required": {
                    "amount_utia": storage_fee_utia,
                    "pay_to": AppConfig.BROKER_ADDRESS,
                    "description": f"Contribute to gathering",
                }
            }), 402

        contribution = gathering_service.contribute(
            gathering_id=gathering_id,
            amount=amount,
            contributor=data["contributor"],
            message=data.get("message", ""),
            payment_proof=payment_proof,
        )

        return jsonify({"success": True, "contribution": contribution})

    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error contributing to gathering {gathering_id}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/gatherings/<gathering_id>/contributions", methods=["GET"])
def get_contributions(gathering_id):
    """Get contributions for a gathering."""
    try:
        limit = min(int(request.args.get("limit", 100)), 500)
        contributions = gathering_service.get_contributions(gathering_id, limit=limit)

        return jsonify({"success": True, "contributions": contributions})

    except Exception as e:
        logger.error(f"Error getting contributions for {gathering_id}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/recent-contributions", methods=["GET"])
def get_recent_contributions():
    """Get recent contributions across all gatherings."""
    try:
        limit = min(int(request.args.get("limit", 10)), 50)
        contributions = gathering_service.get_recent_contributions(limit=limit)

        return jsonify({"success": True, "contributions": contributions})

    except Exception as e:
        logger.error(f"Error getting recent contributions: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# =========================================
# API: USER DATA
# =========================================
@app.route("/api/user/<address>/gatherings", methods=["GET"])
def get_user_gatherings(address):
    """Get gatherings created by a user."""
    try:
        limit = min(int(request.args.get("limit", 50)), 100)
        gatherings = gathering_service.get_user_gatherings(address, limit=limit)

        return jsonify({"success": True, "gatherings": gatherings})

    except Exception as e:
        logger.error(f"Error getting user gatherings for {address}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/user/<address>/contributions", methods=["GET"])
def get_user_contributions(address):
    """Get contributions made by a user."""
    try:
        limit = min(int(request.args.get("limit", 50)), 100)
        contributions = gathering_service.get_user_contributions(address, limit=limit)

        return jsonify({"success": True, "contributions": contributions})

    except Exception as e:
        logger.error(f"Error getting user contributions for {address}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# =========================================
# API: STATS
# =========================================
@app.route("/api/stats", methods=["GET"])
def get_stats():
    """Get platform statistics."""
    try:
        stats = gathering_service.get_stats()
        return jsonify({"success": True, "stats": stats})

    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# =========================================
# API: PRICING
# =========================================
@app.route("/api/pricing", methods=["GET"])
def get_pricing():
    """Get pricing for operations from OnChainDB."""
    operation = request.args.get("operation", "contribute")
    # Estimate data size (KB) for the operation
    size_kb = int(request.args.get("size_kb", 1))

    try:
        # Determine collection based on operation
        collection = "gatherings" if operation == "create" else "contributions"

        # Get actual pricing from OnChainDB
        url = f"{AppConfig.ONCHAINDB_ENDPOINT}/api/pricing/quote"

        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                url,
                json={
                    "app_id": AppConfig.ONCHAINDB_APP_ID,
                    "operation_type": "write",
                    "size_kb": size_kb,
                    "collection": collection,
                },
                headers={
                    "Content-Type": "application/json",
                    "X-App-Key": AppConfig.ONCHAINDB_APP_KEY,
                },
            )
            response.raise_for_status()
            quote_data = response.json()

        # Extract the total cost from the quote
        total_cost_tia = quote_data.get("total_cost_tia", quote_data.get("total_cost", 0))
        amount_utia = int(total_cost_tia * 1_000_000)

        return jsonify({
            "success": True,
            "pricing": {
                "operation": operation,
                "size_kb": size_kb,
                "amount_utia": amount_utia,
                "amount_tia": total_cost_tia,
                "broker_address": AppConfig.BROKER_ADDRESS,
                "quote_details": quote_data,
            },
        })

    except Exception as e:
        logger.error(f"Error getting pricing: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# =========================================
# API: CELESTIA PROXY (for CORS)
# =========================================
@app.route("/api/celestia/balance/<address>", methods=["GET"])
def get_celestia_balance(address):
    """Get wallet balance from Celestia REST API."""
    try:
        url = f"{AppConfig.CELESTIA_REST}/cosmos/bank/v1beta1/balances/{address}"

        with httpx.Client(timeout=10.0) as client:
            response = client.get(url)
            response.raise_for_status()
            data = response.json()

        return jsonify({"success": True, **data})

    except Exception as e:
        logger.error(f"Error getting balance for {address}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/celestia/account/<address>", methods=["GET"])
def get_celestia_account(address):
    """Get account info from Celestia REST API (for signing)."""
    try:
        url = f"{AppConfig.CELESTIA_REST}/cosmos/auth/v1beta1/accounts/{address}"

        with httpx.Client(timeout=10.0) as client:
            response = client.get(url)
            response.raise_for_status()
            data = response.json()

        return jsonify({"success": True, **data})

    except Exception as e:
        logger.error(f"Error getting account for {address}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/celestia/broadcast", methods=["POST"])
def broadcast_celestia_tx():
    """Broadcast transaction to Celestia network."""
    try:
        data = request.get_json()
        tx_bytes = data.get("tx_bytes")
        mode = data.get("mode", "BROADCAST_MODE_SYNC")

        if not tx_bytes:
            return jsonify({"success": False, "error": "Missing tx_bytes"}), 400

        url = f"{AppConfig.CELESTIA_REST}/cosmos/tx/v1beta1/txs"

        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                url,
                json={"tx_bytes": tx_bytes, "mode": mode},
            )

            result = response.json()

            # Check for broadcast errors
            if "tx_response" in result:
                tx_response = result["tx_response"]
                if tx_response.get("code", 0) != 0:
                    return jsonify(
                        {
                            "success": False,
                            "error": tx_response.get("raw_log", "Transaction failed"),
                            "tx_response": tx_response,
                        }
                    ), 400

        return jsonify({"success": True, **result})

    except Exception as e:
        logger.error(f"Error broadcasting transaction: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# =========================================
# API: BLOB STORAGE (Images on Celestia)
# =========================================
@app.route("/api/blobs/upload", methods=["POST"])
def upload_blob():
    """
    Upload an image to Celestia as a blob.

    Expects multipart form data with:
    - file: The image file
    - payment_tx_hash: Payment transaction hash
    - user_address: User's wallet address
    - broker_address: Broker address
    - amount_utia: Amount paid in utia
    """
    try:
        # Check if file is present
        if "file" not in request.files:
            return jsonify({"success": False, "error": "No file provided"}), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({"success": False, "error": "No file selected"}), 400

        # Validate file type
        allowed_types = {"image/png", "image/jpeg", "image/gif", "image/webp"}
        content_type = file.content_type or "application/octet-stream"
        if content_type not in allowed_types:
            return jsonify({"success": False, "error": f"Invalid file type: {content_type}"}), 400

        # Read file data
        blob_data = file.read()

        # Size limit (1.5MB for Celestia blobs)
        if len(blob_data) > 1.5 * 1024 * 1024:
            return jsonify({"success": False, "error": "File too large (max 1.5MB)"}), 400

        # Get payment proof from form data (optional - if missing, returns 402)
        payment_tx_hash = request.form.get("payment_tx_hash", "")

        # If no payment, get pricing quote and return 402
        if not payment_tx_hash:
            size_kb = max(1, (len(blob_data) + 1023) // 1024)

            # Get pricing quote from OnChainDB
            quote = gathering_service.client.get_pricing_quote(
                collection="images",
                operation_type="write",
                size_kb=size_kb,
            )

            total_cost_tia = quote.get("total_cost_tia", quote.get("total_cost", 0))
            amount_utia = int(total_cost_tia * 1_000_000)

            return jsonify({
                "success": False,
                "error": "Payment required",
                "payment_required": {
                    "amount_utia": amount_utia,
                    "pay_to": AppConfig.BROKER_ADDRESS,
                    "description": f"Upload image ({size_kb}KB)",
                }
            }), 402

        payment_proof = {
            "payment_tx_hash": payment_tx_hash,
            "user_address": request.form.get("user_address", ""),
            "broker_address": request.form.get("broker_address", ""),
            "amount_utia": int(request.form.get("amount_utia", 0)),
        }

        # Store blob via SDK
        result = gathering_service.client.store_blob(
            collection="images",
            blob_data=blob_data,
            payment_proof=payment_proof,
            filename=file.filename,
            content_type=content_type,
        )

        blob_id = result.get("blob_id")
        blob_url = f"/api/blobs/{blob_id}"

        return jsonify({
            "success": True,
            "blob_id": blob_id,
            "blob_url": blob_url,
            "size_bytes": len(blob_data),
            "content_type": content_type,
        })

    except Exception as e:
        logger.error(f"Error uploading blob: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/blobs/<blob_id>", methods=["GET"])
def get_blob(blob_id):
    """
    Retrieve a blob by ID.
    Proxies to OnChainDB which fetches from Celestia.
    """
    try:
        # Proxy to OnChainDB blob endpoint
        url = f"{AppConfig.ONCHAINDB_ENDPOINT}/api/apps/{AppConfig.ONCHAINDB_APP_ID}/blobs/images/{blob_id}"

        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                url,
                headers={"X-App-Key": AppConfig.ONCHAINDB_APP_KEY},
            )

            if response.status_code == 404:
                return jsonify({"success": False, "error": "Blob not found"}), 404

            response.raise_for_status()

            # Return the blob with proper content type
            content_type = response.headers.get("content-type", "application/octet-stream")
            return response.content, 200, {"Content-Type": content_type}

    except Exception as e:
        logger.error(f"Error retrieving blob {blob_id}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/blobs/pricing", methods=["GET"])
def get_blob_pricing():
    """Get pricing for blob upload from OnChainDB."""
    size_kb = int(request.args.get("size_kb", 100))

    try:
        # Get actual pricing from OnChainDB
        url = f"{AppConfig.ONCHAINDB_ENDPOINT}/api/pricing/quote"

        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                url,
                json={
                    "app_id": AppConfig.ONCHAINDB_APP_ID,
                    "operation_type": "write",
                    "size_kb": size_kb,
                    "collection": "images",
                },
                headers={
                    "Content-Type": "application/json",
                    "X-App-Key": AppConfig.ONCHAINDB_APP_KEY,
                },
            )
            response.raise_for_status()
            quote_data = response.json()

        # Extract the total cost from the quote
        total_cost_tia = quote_data.get("total_cost_tia", quote_data.get("total_cost", 0))
        amount_utia = int(total_cost_tia * 1_000_000)

        return jsonify({
            "success": True,
            "pricing": {
                "size_kb": size_kb,
                "amount_utia": amount_utia,
                "amount_tia": total_cost_tia,
                "broker_address": AppConfig.BROKER_ADDRESS,
                "quote_details": quote_data,
            }
        })

    except Exception as e:
        logger.error(f"Error getting blob pricing: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# =========================================
# ERROR HANDLERS
# =========================================
@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors."""
    if request.path.startswith("/api/"):
        return jsonify({"success": False, "error": "Not found"}), 404
    return render_template("index.html")


@app.errorhandler(500)
def server_error(e):
    """Handle 500 errors."""
    logger.error(f"Server error: {e}")
    return jsonify({"success": False, "error": "Internal server error"}), 500


# =========================================
# MAIN
# =========================================
if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5001,
        debug=AppConfig.DEBUG,
    )
