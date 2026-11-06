"""Generate edge-case fixtures that pdf-lib cannot produce: RC4-encrypted and 0-page."""
from pathlib import Path
from pypdf import PdfReader, PdfWriter

FIX = Path(__file__).parent / "fixtures"

# 0 pages.
writer = PdfWriter()
writer.write(FIX / "zero-pages.pdf")

# Encrypted with a non-empty user password (cannot be opened without it).
reader = PdfReader(FIX / "fontsizes.pdf")
writer = PdfWriter()
writer.append(reader)
writer.encrypt(user_password="secret", owner_password="owner", algorithm="RC4-128")
writer.write(FIX / "encrypted.pdf")

print("zero-pages:", (FIX / "zero-pages.pdf").stat().st_size)
print("encrypted :", (FIX / "encrypted.pdf").stat().st_size)
