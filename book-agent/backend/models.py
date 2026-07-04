from sqlalchemy import Column, Integer, String, JSON, Boolean, DateTime
from database import Base
import datetime

class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, index=True)
    job_type = Column(String, index=True) # layout, scan, translate, cover, proofread, editor_session, editor_job
    stage = Column(String, default="queued")
    pct = Column(Integer, default=0)
    message = Column(String, default="")
    result_json = Column(JSON, default=dict)
    is_cancelled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class Book(Base):
    __tablename__ = "books"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    topic = Column(String)
    style = Column(String)
    language = Column(String)
    chapter_count = Column(Integer)
    total_sections = Column(Integer, default=0)
    pages = Column(Integer)
    job_id = Column(String)

class BookSegment(Base):
    __tablename__ = "book_segments"
    id = Column(Integer, primary_key=True, index=True)
    book_id = Column(Integer, index=True)
    type = Column(String) # 'chapter' or 'section'
    order_index = Column(Integer)
    title = Column(String)
    content = Column(String)
    parent_id = Column(Integer, nullable=True)