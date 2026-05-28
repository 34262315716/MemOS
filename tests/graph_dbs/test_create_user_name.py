"""Tests for the ``create_user_name`` cube-registration helper added to
Neo4jGraphDB and PolarDBGraphDB in response to Issue #1681.

These tests use mocked drivers/connections — they intentionally avoid
spinning up a real Neo4j or PolarDB instance.
"""

from unittest.mock import MagicMock, patch

import pytest

from memos.configs.graph_db import Neo4jGraphDBConfig


@pytest.fixture
def shared_db_config():
    return Neo4jGraphDBConfig(
        uri="bolt://localhost:7687",
        user="neo4j",
        password="test",
        db_name="test_db",
        auto_create=False,
        use_multi_db=False,
        user_name="default_user",
        embedding_dimension=3,
    )


@pytest.fixture
def neo4j_db(shared_db_config):
    with patch("neo4j.GraphDatabase") as mock_gd:
        mock_driver = MagicMock()
        mock_gd.driver.return_value = mock_driver
        from memos.graph_dbs.neo4j import Neo4jGraphDB

        db = Neo4jGraphDB(shared_db_config)
        db.driver = mock_driver
        yield db


class TestNeo4jCreateUserName:
    """Cube registration is idempotent and skips work when the cube exists."""

    def test_returns_false_when_cube_already_exists(self, neo4j_db):
        """Pre-existing user_name should short-circuit without issuing a CREATE."""
        with patch.object(
            neo4j_db, "exist_user_name", return_value={"alice_cube": True}
        ) as mock_exist:
            created = neo4j_db.create_user_name("alice_cube", owner_id="alice")

        assert created is False
        mock_exist.assert_called_once_with("alice_cube")
        # The driver should not be touched when the cube already exists.
        neo4j_db.driver.session.assert_not_called()

    def test_creates_marker_node_when_cube_missing(self, neo4j_db):
        """First-time registration emits a deterministic marker id and reports True."""
        mock_session = MagicMock()
        # Make `with self.driver.session(...) as session:` yield mock_session.
        neo4j_db.driver.session.return_value.__enter__.return_value = mock_session

        with patch.object(neo4j_db, "exist_user_name", return_value={"alice_cube": False}):
            created = neo4j_db.create_user_name("alice_cube", owner_id="alice")

        assert created is True
        mock_session.run.assert_called_once()
        kwargs = mock_session.run.call_args.kwargs
        # The marker id is deterministic so repeated calls MERGE on the same node.
        assert kwargs["id"] == "_cube_marker:alice_cube"
        assert kwargs["user_name"] == "alice_cube"
        assert kwargs["owner_id"] == "alice"

    def test_rejects_empty_user_name(self, neo4j_db):
        """An empty string is never a valid cube id — fail loudly."""
        with pytest.raises(ValueError):
            neo4j_db.create_user_name("")

    def test_owner_id_defaults_to_empty_string(self, neo4j_db):
        """owner_id is optional; missing values become an empty string on the marker."""
        mock_session = MagicMock()
        neo4j_db.driver.session.return_value.__enter__.return_value = mock_session

        with patch.object(neo4j_db, "exist_user_name", return_value={"orphan_cube": False}):
            created = neo4j_db.create_user_name("orphan_cube")

        assert created is True
        kwargs = mock_session.run.call_args.kwargs
        assert kwargs["owner_id"] == ""
