"""
Sample Python application for testing.
"""

def calculate_sum(numbers: list[int]) -> int:
    """
    Calculate the sum of a list of numbers.

    Args:
        numbers: List of integers to sum

    Returns:
        The sum of all numbers in the list
    """
    return sum(numbers)


def greet_user(name: str = "Guest") -> str:
    """Greet a user by name."""
    return f"Hello, {name}!"


if __name__ == "__main__":
    result = calculate_sum([1, 2, 3, 4, 5])
    print(f"Sum: {result}")
    print(greet_user("Alice"))
