"""
Unit tests for server_router input/output format validation.

This module tests that the server_router endpoints correctly validate
input request formats and return properly formatted responses.
"""

from unittest.mock import Mock, patch

import pytest

from fastapi.testclient import TestClient

from memos.api.product_models import (
    APIADDRequest,
    APIChatCompleteRequest,
    APISearchRequest,
    CreateCubeRequest,
    CreateCubeResponse,
    MemoryResponse,
    SearchResponse,
    SuggestionResponse,
)


# Patch init_server so we can import server_api without starting the full MemOS stack,
# and keep sklearn and other core dependencies untouched for other tests.
@pytest.fixture(scope="module")
def mock_init_server():
    """Mock init_server before importing server_api."""
    # Create mock components
    mock_components = {
        "graph_db": Mock(),
        "mem_reader": Mock(),
        "llm": Mock(),
        "embedder": Mock(),
        "reranker": Mock(),
        "internet_retriever": Mock(),
        "memory_manager": Mock(),
        "default_cube_config": Mock(),
        "mos_server": Mock(),
        "mem_scheduler": Mock(),
        "feedback_server": Mock(),
        "naive_mem_cube": Mock(),
        "searcher": Mock(),
        "api_module": Mock(),
        "vector_db": None,
        "pref_extractor": None,
        "pref_adder": None,
        "pref_retriever": None,
        "pref_mem": None,
        "online_bot": None,
        "chat_llms": Mock(),
        "redis_client": Mock(),
        "deepsearch_agent": Mock(),
    }

    with patch("memos.api.handlers.init_server", return_value=mock_components):
        # Import after patching
        from memos.api import server_api

        yield server_api.app


@pytest.fixture
def client(mock_init_server):
    """Create test client for server_api."""
    return TestClient(mock_init_server)


@pytest.fixture
def mock_handlers():
    """Mock all handlers used by server_router."""
    with (
        patch("memos.api.routers.server_router.search_handler") as mock_search,
        patch("memos.api.routers.server_router.add_handler") as mock_add,
        patch("memos.api.routers.server_router.chat_handler") as mock_chat,
        patch("memos.api.routers.server_router.handlers.suggestion_handler") as mock_suggestion,
        patch("memos.api.routers.server_router.handlers.memory_handler") as mock_memory,
    ):
        # Set up default return values
        mock_search.handle_search_memories.return_value = SearchResponse(
            message="Search completed successfully",
            data={"text_mem": [], "act_mem": [], "para_mem": []},
        )

        mock_add.handle_add_memories.return_value = MemoryResponse(
            message="Memory added successfully", data=[]
        )

        mock_chat.handle_chat_complete.return_value = {
            "message": "Chat completed successfully",
            "data": {"response": "test response", "references": []},
        }

        mock_suggestion.handle_get_suggestion_queries.return_value = SuggestionResponse(
            message="Suggestions retrieved successfully", data={"query": ["suggestion1"]}
        )

        mock_memory.handle_get_all_memories.return_value = MemoryResponse(
            message="Memories retrieved successfully", data=[]
        )

        mock_memory.handle_get_subgraph.return_value = MemoryResponse(
            message="Memories retrieved successfully", data=[]
        )

        yield {
            "search": mock_search,
            "add": mock_add,
            "chat": mock_chat,
            "suggestion": mock_suggestion,
            "memory": mock_memory,
        }


class TestServerRouterSearch:
    """Test /search endpoint input/output format."""

    def test_search_valid_input_output(self, mock_handlers, client):
        """Test search endpoint with valid input returns correct output format."""
        request_data = {
            "query": "test query",
            "user_id": "test_user",
            "mem_cube_id": "test_cube",
            "top_k": 10,
        }

        response = client.post("/product/search", json=request_data)

        assert response.status_code == 200
        data = response.json()

        # Validate response structure
        assert "code" in data
        assert "message" in data
        assert "data" in data
        assert data["code"] == 200
        assert isinstance(data["data"], dict)

        # Verify handler was called with correct request type
        mock_handlers["search"].handle_search_memories.assert_called_once()
        call_args = mock_handlers["search"].handle_search_memories.call_args[0][0]
        assert isinstance(call_args, APISearchRequest)
        assert call_args.query == "test query"
        assert call_args.user_id == "test_user"

    def test_search_invalid_input_missing_query(self, mock_handlers, client):
        """Test search endpoint with missing required field."""
        request_data = {
            "user_id": "test_user",
        }

        response = client.post("/product/search", json=request_data)

        # Should return validation error
        assert response.status_code == 422

    def test_search_response_format(self, mock_handlers, client):
        """Test search endpoint returns SearchResponse format."""
        mock_handlers["search"].handle_search_memories.return_value = SearchResponse(
            message="Search completed successfully",
            data={
                "text_mem": [{"cube_id": "test_cube", "memories": []}],
                "act_mem": [],
                "para_mem": [],
            },
        )

        request_data = {
            "query": "test query",
            "user_id": "test_user_id",
            "mem_cube_id": "test_cube",
        }

        response = client.post("/product/search", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Search completed successfully"
        assert isinstance(data["data"], dict)
        assert "text_mem" in data["data"]


class TestServerRouterAdd:
    """Test /add endpoint input/output format."""

    def test_add_valid_input_output(self, mock_handlers, client):
        """Test add endpoint with valid input returns correct output format."""
        request_data = {
            "mem_cube_id": "test_cube",
            "user_id": "test_user",
            "memory_content": "test memory content",
        }

        response = client.post("/product/add", json=request_data)

        assert response.status_code == 200
        data = response.json()

        # Validate response structure
        assert "code" in data
        assert "message" in data
        assert "data" in data
        assert data["code"] == 200
        assert isinstance(data["data"], list)

        # Verify handler was called with correct request type
        mock_handlers["add"].handle_add_memories.assert_called_once()
        call_args = mock_handlers["add"].handle_add_memories.call_args[0][0]
        assert isinstance(call_args, APIADDRequest)
        assert call_args.mem_cube_id == "test_cube"
        assert call_args.user_id == "test_user"

    def test_add_response_format(self, mock_handlers, client):
        """Test add endpoint returns MemoryResponse format."""
        mock_handlers["add"].handle_add_memories.return_value = MemoryResponse(
            message="Memory added successfully",
            data=[{"cube_id": "test_cube", "memories": []}],
        )

        request_data = {
            "mem_cube_id": "test_cube",
            "memory_content": "test memory content",
        }

        response = client.post("/product/add", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Memory added successfully"
        assert isinstance(data["data"], list)


class TestServerRouterChatComplete:
    """Test /chat/complete endpoint input/output format."""

    def test_chat_complete_valid_input_output(self, mock_handlers, client):
        """Test chat/complete endpoint with valid input returns correct output format."""
        request_data = {
            "user_id": "test_user",
            "query": "test query",
            "mem_cube_id": "test_cube",
        }

        response = client.post("/product/chat/complete", json=request_data)

        assert response.status_code == 200
        data = response.json()

        # Validate response structure
        assert "message" in data
        assert "data" in data
        assert isinstance(data["data"], dict)
        assert "response" in data["data"]
        assert "references" in data["data"]

        # Verify handler was called with correct request type
        mock_handlers["chat"].handle_chat_complete.assert_called_once()
        call_args = mock_handlers["chat"].handle_chat_complete.call_args[0][0]
        assert isinstance(call_args, APIChatCompleteRequest)
        assert call_args.user_id == "test_user"
        assert call_args.query == "test query"

    def test_chat_complete_invalid_input_missing_user_id(self, mock_handlers, client):
        """Test chat/complete endpoint with missing required field."""
        request_data = {
            "query": "test query",
        }

        response = client.post("/product/chat/complete", json=request_data)

        # Should return validation error
        assert response.status_code == 422

    def test_chat_complete_response_format(self, mock_handlers, client):
        """Test chat/complete endpoint returns correct format."""
        mock_handlers["chat"].handle_chat_complete.return_value = {
            "message": "Chat completed successfully",
            "data": {"response": "test response", "references": [{"id": "ref1"}]},
        }

        request_data = {
            "user_id": "test_user",
            "query": "test query",
        }

        response = client.post("/product/chat/complete", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Chat completed successfully"
        assert isinstance(data["data"]["response"], str)
        assert isinstance(data["data"]["references"], list)


class TestServerRouterSuggestions:
    """Test /suggestions endpoint input/output format."""

    def test_suggestions_valid_input_output(self, mock_handlers, client):
        """Test suggestions endpoint with valid input returns correct output format."""
        request_data = {
            "user_id": "test_user",
            "mem_cube_id": "test_cube",
            "language": "zh",
        }

        response = client.post("/product/suggestions", json=request_data)

        assert response.status_code == 200
        data = response.json()

        # Validate response structure
        assert "code" in data
        assert "message" in data
        assert "data" in data
        assert data["code"] == 200

        # Verify handler was called
        mock_handlers["suggestion"].handle_get_suggestion_queries.assert_called_once()

    def test_suggestions_invalid_input_missing_user_id(self, mock_handlers, client):
        """Test suggestions endpoint with missing required field."""
        request_data = {
            "mem_cube_id": "test_cube",
        }

        response = client.post("/product/suggestions", json=request_data)

        # Should return validation error
        assert response.status_code == 422

    def test_suggestions_response_format(self, mock_handlers, client):
        """Test suggestions endpoint returns SuggestionResponse format."""
        mock_handlers["suggestion"].handle_get_suggestion_queries.return_value = SuggestionResponse(
            message="Suggestions retrieved successfully",
            data={"query": ["suggestion1", "suggestion2"]},
        )

        request_data = {
            "user_id": "test_user",
            "mem_cube_id": "test_cube",
            "language": "en",
        }

        response = client.post("/product/suggestions", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Suggestions retrieved successfully"
        assert isinstance(data["data"], dict)
        assert "query" in data["data"]


class TestServerRouterGetAll:
    """Test /get_all endpoint input/output format."""

    def test_get_all_valid_input_output(self, mock_handlers, client):
        """Test get_all endpoint with valid input returns correct output format."""
        request_data = {
            "user_id": "test_user",
            "memory_type": "text_mem",
        }

        response = client.post("/product/get_all", json=request_data)

        assert response.status_code == 200
        data = response.json()

        # Validate response structure
        assert "code" in data
        assert "message" in data
        assert "data" in data
        assert data["code"] == 200
        assert isinstance(data["data"], list)

    def test_get_all_with_search_query(self, mock_handlers, client):
        """Test get_all endpoint with search_query uses subgraph handler."""
        request_data = {
            "user_id": "test_user",
            "memory_type": "text_mem",
            "search_query": "test query",
        }

        response = client.post("/product/get_all", json=request_data)

        assert response.status_code == 200
        # Verify subgraph handler was called
        mock_handlers["memory"].handle_get_subgraph.assert_called_once()

    def test_get_all_invalid_input_missing_user_id(self, mock_handlers, client):
        """Test get_all endpoint with missing required field."""
        request_data = {
            "memory_type": "text_mem",
        }

        response = client.post("/product/get_all", json=request_data)

        # Should return validation error
        assert response.status_code == 422

    def test_get_all_response_format(self, mock_handlers, client):
        """Test get_all endpoint returns MemoryResponse format."""
        mock_handlers["memory"].handle_get_all_memories.return_value = MemoryResponse(
            message="Memories retrieved successfully",
            data=[{"cube_id": "test_cube", "memories": []}],
        )

        request_data = {
            "user_id": "test_user",
            "memory_type": "text_mem",
        }

        response = client.post("/product/get_all", json=request_data)

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Memories retrieved successfully"
        assert isinstance(data["data"], list)


class TestServerRouterCreateCube:
    """Tests for the explicit ``POST /product/create_cube`` endpoint added
    in response to Issue #1681.

    Without explicit cube creation, ``/add`` happily accepts an unknown
    ``mem_cube_id`` and writes embeddings to the vector store, but
    ``/search`` returns empty results because the tree registry has no
    entry for the cube. The new endpoint is intentionally idempotent so
    that "register before write" is a no-op for already-existing cubes.
    """

    def test_create_cube_new(self, client):
        """A new cube_id reaches graph_db.create_user_name and returns created=True."""
        with patch("memos.api.routers.server_router.graph_db") as mock_graph_db:
            mock_graph_db.exist_user_name.return_value = {"my_custom_cube": False}
            mock_graph_db.create_user_name.return_value = True

            request_data = {
                "cube_id": "my_custom_cube",
                "owner_id": "user_alice",
            }
            response = client.post("/product/create_cube", json=request_data)

            assert response.status_code == 200
            data = response.json()
            assert data["code"] == 200
            assert data["message"] == "Cube created"
            assert data["data"]["cube_id"] == "my_custom_cube"
            assert data["data"]["owner_id"] == "user_alice"
            assert data["data"]["created"] is True
            # cube_name defaults to cube_id when not provided
            assert data["data"]["cube_name"] == "my_custom_cube"

            mock_graph_db.create_user_name.assert_called_once_with(
                user_name="my_custom_cube", owner_id="user_alice"
            )

    def test_create_cube_idempotent(self, client):
        """Calling create_cube for an existing cube returns created=False, not 409."""
        with patch("memos.api.routers.server_router.graph_db") as mock_graph_db:
            mock_graph_db.create_user_name.return_value = False

            request_data = {
                "cube_id": "existing_cube",
                "owner_id": "user_alice",
                "cube_name": "Existing Cube",
            }
            response = client.post("/product/create_cube", json=request_data)

            assert response.status_code == 200
            data = response.json()
            assert data["message"] == "Cube already exists"
            assert data["data"]["created"] is False
            assert data["data"]["cube_name"] == "Existing Cube"

    def test_create_cube_missing_required_field(self, client):
        """cube_id is required; missing it surfaces 422 from FastAPI."""
        response = client.post(
            "/product/create_cube",
            json={"owner_id": "user_alice"},
        )
        assert response.status_code == 422

    def test_create_cube_backend_without_create_user_name(self, client):
        """When the backend lacks create_user_name and cube doesn't exist, return 501.

        This guards integrators against silently treating a no-op as success
        on backends that haven't shipped the new method.
        """
        with patch("memos.api.routers.server_router.graph_db") as mock_graph_db:
            # Simulate a backend that has exist_user_name but not create_user_name.
            mock_graph_db.exist_user_name.return_value = {"new_cube": False}
            # Use spec to ensure hasattr(...) returns False for create_user_name.
            del mock_graph_db.create_user_name

            request_data = {"cube_id": "new_cube", "owner_id": "user_alice"}
            response = client.post("/product/create_cube", json=request_data)

            assert response.status_code == 501

    def test_create_cube_request_model_defaults(self):
        """CreateCubeRequest exposes cube_name as optional and CreateCubeResponse
        encodes the standard BaseResponse envelope."""
        req = CreateCubeRequest(cube_id="c1", owner_id="o1")
        assert req.cube_name is None

        resp = CreateCubeResponse(
            message="ok",
            data={"cube_id": "c1", "created": True},
        )
        assert resp.code == 200
        assert resp.data["cube_id"] == "c1"


class TestServerRouterStrictCubeValidation:
    """Tests for the opt-in ``MEMOS_STRICT_CUBE_VALIDATION`` mode added in
    response to Issue #1681.

    By default (flag off) the existing behaviour is preserved — /add and
    /search never reject requests on unknown cube_ids. When the flag is
    on, explicit cube ids that don't exist in the registry return HTTP
    404 with a clear message instead of silently producing empty results.
    """

    def test_search_returns_404_when_strict_and_cube_missing(self, mock_handlers, client):
        with (
            patch("memos.api.routers.server_router.STRICT_CUBE_VALIDATION", True),
            patch("memos.api.routers.server_router.graph_db") as mock_graph_db,
        ):
            mock_graph_db.exist_user_name.return_value = {"ghost_cube": False}

            response = client.post(
                "/product/search",
                json={
                    "query": "q",
                    "user_id": "u1",
                    "mem_cube_id": "ghost_cube",
                },
            )
            assert response.status_code == 404
            assert "ghost_cube" in response.json()["detail"]
            # The handler must not run when validation rejects the request.
            mock_handlers["search"].handle_search_memories.assert_not_called()

    def test_add_returns_404_when_strict_and_cube_missing(self, mock_handlers, client):
        with (
            patch("memos.api.routers.server_router.STRICT_CUBE_VALIDATION", True),
            patch("memos.api.routers.server_router.graph_db") as mock_graph_db,
        ):
            mock_graph_db.exist_user_name.return_value = {"ghost_cube": False}

            response = client.post(
                "/product/add",
                json={
                    "mem_cube_id": "ghost_cube",
                    "user_id": "u1",
                    "memory_content": "hello",
                },
            )
            assert response.status_code == 404
            assert "create_cube" in response.json()["detail"]
            mock_handlers["add"].handle_add_memories.assert_not_called()

    def test_add_passes_when_strict_and_cube_exists(self, mock_handlers, client):
        with (
            patch("memos.api.routers.server_router.STRICT_CUBE_VALIDATION", True),
            patch("memos.api.routers.server_router.graph_db") as mock_graph_db,
        ):
            mock_graph_db.exist_user_name.return_value = {"good_cube": True}

            response = client.post(
                "/product/add",
                json={
                    "mem_cube_id": "good_cube",
                    "user_id": "u1",
                    "memory_content": "hello",
                },
            )
            assert response.status_code == 200
            mock_handlers["add"].handle_add_memories.assert_called_once()

    def test_add_skips_validation_when_strict_but_no_explicit_cube(self, mock_handlers, client):
        """If the caller did not provide an explicit cube_id, the legacy
        implicit-default-to-user_id path is preserved even in strict mode."""
        with (
            patch("memos.api.routers.server_router.STRICT_CUBE_VALIDATION", True),
            patch("memos.api.routers.server_router.graph_db") as mock_graph_db,
        ):
            response = client.post(
                "/product/add",
                json={"user_id": "u1", "memory_content": "hello"},
            )
            assert response.status_code == 200
            # exist_user_name should not even be consulted in this case.
            mock_graph_db.exist_user_name.assert_not_called()
            mock_handlers["add"].handle_add_memories.assert_called_once()

    def test_validation_disabled_by_default(self, mock_handlers, client):
        """Default behaviour preserves backward compatibility — no 404 even
        if the cube has never been registered."""
        with patch("memos.api.routers.server_router.graph_db") as mock_graph_db:
            mock_graph_db.exist_user_name.return_value = {"ghost_cube": False}

            response = client.post(
                "/product/add",
                json={
                    "mem_cube_id": "ghost_cube",
                    "user_id": "u1",
                    "memory_content": "hello",
                },
            )
            assert response.status_code == 200
            mock_handlers["add"].handle_add_memories.assert_called_once()
