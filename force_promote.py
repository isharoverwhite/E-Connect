from app.api import get_db, SessionLocal
from app.sql_models import BuildJob, DiyProject
from app.services.builder import promote_build_job_project_config

db = SessionLocal()
job = db.query(BuildJob).filter(BuildJob.id == 'e904f4c7-1374-4287-ad26-8d8c9e94e94d').first()
if job:
    print("Found job:", job.id)
    success = promote_build_job_project_config(job)
    if success:
        db.commit()
        print("Promoted successfully!")
    else:
        print("Failed to promote!")
else:
    print("Job not found!")
