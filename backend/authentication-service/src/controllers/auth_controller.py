from flask import Blueprint, jsonify, redirect, request
import os
import logging

logger = logging.getLogger(__name__)

try:
    from ..services.google_auth_service import GoogleAuthService
    from ..services.user_auth_service import UserAuthService
except ImportError:
    from services.google_auth_service import GoogleAuthService
    from services.user_auth_service import UserAuthService

auth_bp = Blueprint("auth_bp", __name__)
google_auth_service = GoogleAuthService()
user_auth_service = UserAuthService()

@auth_bp.route("/api/v1/auth/google/login", methods=["GET"])
def login():
    """Generate Google OAuth2 authorization URL"""
    auth_url = google_auth_service.get_authorization_url()
    return jsonify({"auth_url": auth_url})

@auth_bp.route("/auth/callback")
def callback():
    """Handle Google OAuth callback, exchange code for tokens, and set secure cookies."""
    code = request.args.get("code")
    credentials = google_auth_service.exchange_code_for_token(code)
    if not credentials:
        return jsonify({"error": "Invalid credentials"}), 400

    token_info = google_auth_service.verify_token(credentials.id_token)
    if not token_info:
        return jsonify({"error": "Invalid token"}), 400

    email = token_info.get("email")
    google_id = token_info.get("sub")  # Google's unique user ID
    username = token_info.get("name") or token_info.get("given_name") or (email.split("@")[0] if email else None)

    if not email or not google_id:
        return jsonify({"error": "Incomplete token data"}), 400

    user = user_auth_service.upsert_google_user(email, google_id, username)
    tokens = user_auth_service.generate_tokens_for_user(user)
    logger.info("OAuth callback successful for user: %s", email)
    
    cookie_secure_env = os.getenv("COOKIE_SECURE", "True")  
    cookie_secure = cookie_secure_env.lower() in ("true", "1", "yes") 

    response = redirect(f"{os.getenv('FRONTEND_URL')}/")
    response.set_cookie(
        "access_token",
        tokens["access_token"],
        httponly=True,
        secure=cookie_secure,
        samesite="Lax"
    )
    response.set_cookie(
        "refresh_token",
        tokens["refresh_token"],
        httponly=True,
        secure=cookie_secure,
        samesite="Lax"
    )
    return response


@auth_bp.route("/api/v1/auth/logout", methods=["POST"])
def logout():
    """Clear authentication cookies to invalidate current session."""
    response = jsonify({"message": "Logged out successfully"})
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return response

@auth_bp.route("/api/v1/auth/login", methods=["POST"])
def login_email():
    """Authenticate user with email/password and issue access/refresh token cookies."""
    data = request.get_json() or {}
    email = data.get("email")
    password = data.get("password")

    success, auth_response = user_auth_service.authenticate(email, password)
    if not success:
        return jsonify({"error": auth_response}), 400

    tokens = auth_response  # contains access_token, refresh_token, token_type, user
    response = jsonify({
        "user": {
            "id": tokens["user"]["id"],
            "email": email,
            "username": tokens["user"].get("username")
        },
        "message": "Logged in successfully"
    })
    response.set_cookie(
        "access_token",
        tokens["access_token"],
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=3600
    )
    response.set_cookie(
        "refresh_token",
        tokens["refresh_token"],
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=30 * 24 * 3600
    )
    return response, 200


@auth_bp.route("/api/v1/auth/register", methods=["POST"])
def register():
    """Create new user account and automatically log them in with cookies."""
    data = request.get_json() or {}
    email = data.get("email")
    password = data.get("password")
    username = data.get("username")

    success, message = user_auth_service.register_user(email, password, username)
    if not success:
        return jsonify({"error": message}), 400

    auth_success, tokens = user_auth_service.authenticate(email, password)
    if not auth_success:
        return jsonify({"message": "Registered successfully, but login failed"}), 201

    response = jsonify({
        "user": {
            "id": tokens["user"]["id"],
            "email": email,
            "username": username
        },
        "message": "Registered successfully"
    })
    response.set_cookie("access_token", tokens["access_token"], httponly=True, secure=True, samesite="Lax", max_age=3600)
    response.set_cookie("refresh_token", tokens["refresh_token"], httponly=True, secure=True, samesite="Lax", max_age=30 * 24 * 3600)
    return response, 201


@auth_bp.route("/api/v1/users/<user_id>", methods=["DELETE"]) 
def delete_user(user_id):
    """Permanently remove user from the system."""
    success, message = user_auth_service.delete_user(user_id)
    if success:
        return jsonify({"message": message}), 200
    return jsonify({"error": message}), 404

@auth_bp.route("/api/v1/users", methods=["GET"])
def list_users():
    """Retrieve list of all registered users."""
    users = user_auth_service.list_users()
    return jsonify({"users": users}), 200

@auth_bp.route("/api/v1/auth/refresh", methods=["POST"])
def refresh():
    """Exchange valid refresh_token for new access_token."""
    refresh_token = (
        request.cookies.get("refresh_token")
        or (request.get_json() or {}).get("refresh_token")
    )
    if not refresh_token:
        return jsonify({"error": "Missing refresh token"}), 400
    
    success, result = user_auth_service.refresh_tokens(refresh_token)
    if not success:
        return jsonify({"error": result}), 401
    
    response = jsonify(result)
    response.set_cookie(
        "access_token",
        result["access_token"],
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=3600
    )
    return response, 200

@auth_bp.route("/api/v1/auth/me", methods=["GET"])
def get_current_user():
    """Get current authenticated user profile."""
    # Try cookie first
    access_token = request.cookies.get("access_token")
    # Fallback to Authorization header if cookie missing
    if not access_token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            access_token = auth_header[7:]
    if not access_token:
        return jsonify({"isAuthenticated": False, "user": None, "access_token": None}), 200
    valid, payload = user_auth_service.verify_token(access_token)
    if not valid or payload.get("type") != "access":
        return jsonify({"isAuthenticated": False, "user": None, "access_token": None}), 200
    user_id = payload.get("sub")
    if not user_id:
        return jsonify({"isAuthenticated": False, "user": None, "access_token": None}), 200
    user = user_auth_service.get_user_by_id(user_id)
    if not user:
        return jsonify({"isAuthenticated": False, "user": None, "access_token": None}), 200
    return jsonify({
        "isAuthenticated": True,
        "user": {
            "id": user["id"],
            "username": user.get("username"),
            "email": user.get("email"),
        },
        "access_token": access_token
    }), 200
