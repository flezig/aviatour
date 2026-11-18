class SearchError(Exception):
    def __init__(self, code, message, status=502, retry_after=None):
        self.code, self.message, self.status, self.retry_after = code, message, status, retry_after
        super().__init__(message)
