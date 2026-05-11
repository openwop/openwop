package openwopclient

import "testing"

func TestIsHTTPErrorCode(t *testing.T) {
	if !IsHTTPErrorCode(HTTPErrorRateLimited) {
		t.Fatalf("expected %q to be recognized", HTTPErrorRateLimited)
	}

	if IsHTTPErrorCode("host_extension_error") {
		t.Fatalf("expected unknown extension code to remain unrecognized")
	}
}

func TestHTTPErrorCodesIncludesCanonicalCodes(t *testing.T) {
	for _, code := range []string{
		HTTPErrorUnauthenticated,
		HTTPErrorForbidden,
		HTTPErrorValidationError,
		HTTPErrorRateLimited,
		HTTPErrorUnsupportedStreamMode,
		HTTPErrorCredentialForbidden,
		HTTPErrorInternalError,
	} {
		if !IsHTTPErrorCode(code) {
			t.Fatalf("expected canonical code %q in HTTPErrorCodes", code)
		}
	}
}
