from abc import ABC, abstractmethod


class Base(ABC):
    @abstractmethod
    def generate(self, query: str, chunks: list[str], focus: str | None = None) -> dict:
        pass

