import unittest

from openwop_client import HTTP_ERROR_CODES, is_http_error_code


class HTTPErrorHelperTests(unittest.TestCase):
    def test_is_http_error_code_accepts_canonical_codes(self) -> None:
        for code in (
            "unauthenticated",
            "forbidden",
            "validation_error",
            "rate_limited",
            "unsupported_stream_mode",
            "credential_forbidden",
            "internal_error",
        ):
            with self.subTest(code=code):
                self.assertTrue(is_http_error_code(code))

    def test_is_http_error_code_rejects_unknown_or_non_string_values(self) -> None:
        self.assertFalse(is_http_error_code("host_extension_error"))
        self.assertFalse(is_http_error_code(None))

    def test_exported_code_set_is_read_only(self) -> None:
        self.assertIsInstance(HTTP_ERROR_CODES, frozenset)


if __name__ == "__main__":
    unittest.main()
