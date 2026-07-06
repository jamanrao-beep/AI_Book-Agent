from database import SessionLocal
from models import Job
from main import _proofread_jobs
import uuid

job_id = uuid.uuid4().hex
print(f"Creating job {job_id}")

_proofread_jobs[job_id] = {"stage": "queued", "original_filename": "test.txt"}

with SessionLocal() as db:
    job = db.query(Job).filter(Job.id == job_id).first()
    if job:
        print(f"Job found! stage={job.stage}, json={job.result_json}")
    else:
        print("Job NOT FOUND in DB!")

    print("Total jobs in DB:", db.query(Job).count())
