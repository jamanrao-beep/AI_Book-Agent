# pyrefly: ignore [missing-import]
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class Book(Base):
    __tablename__ = "books"
    id             = Column(Integer, primary_key=True, index=True)
    title          = Column(String(500))
    num_pages      = Column(Integer)
    words_per_page = Column(Integer)
    status         = Column(String(50), default="pending")
    outline        = Column(Text, nullable=True)
    pdf_url        = Column(String(1000), nullable=True)
    docx_url       = Column(String(1000), nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)
    user_id        = Column(String(200), nullable=True)
    writing_style  = Column(String(200), nullable=True, default="")

class BookSegment(Base):
    __tablename__ = "book_segments"
    id             = Column(Integer, primary_key=True, index=True)
    book_id        = Column(Integer, index=True)
    chapter_number = Column(Integer)
    chapter_title  = Column(String(500))
    subheading     = Column(String(500))
    content        = Column(Text)
    segment_order  = Column(Integer)
    is_complete    = Column(Boolean, default=False)
    created_at     = Column(DateTime, default=datetime.utcnow)