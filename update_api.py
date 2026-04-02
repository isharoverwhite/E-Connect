import re

with open("server/app/api.py", "r") as f:
    api_text = f.read()

endpoint_code = """
@router.post("/device/{device_id}/action/rebuild")
async def rebuild_device_firmware(
    device_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    \"\"\"
    Trigger a firmware rebuild for a device using its currently committed configuration.
    \"\"\"
    device = _get_device_in_household_or_404(db, current_user, device_id)
    if not device.provisioning_project_id:
        raise HTTPException(status_code=400, detail="Not a managed DIY device")

    project = _get_project_in_household_or_404(db, current_user, device.provisioning_project_id)
    
    from app.sql_models import SavedConfig
    committed_config = db.query(SavedConfig).filter(
        SavedConfig.project_id == project.id,
        SavedConfig.is_committed == True
    ).order_by(SavedConfig.id.desc()).first()
    
    if not committed_config:
        raise HTTPException(status_code=400, detail="No committed configuration found for this device")

    if project.pending_build_job_id:
        job = db.query(BuildJob).filter(BuildJob.id == project.pending_build_job_id).first()
        if job and job.status in {JobStatus.queued, JobStatus.building}:
            return {
                "status": "success",
                "job_id": job.id,
                "config_id": committed_config.id,
                "message": "Rebuild job already queued or building.",
            }
            
    import uuid
    job_id = str(uuid.uuid4())
    job = BuildJob(
        id=job_id,
        project_id=project.id,
        status=JobStatus.queued,
        saved_config_id=committed_config.id,
        staged_project_config=committed_config.config_payload,
    )
    db.add(job)
    project.pending_config = committed_config.config_payload
    project.pending_config_id = committed_config.id
    project.pending_build_job_id = job.id
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        build_firmware_task,
        job.id,
        [],
        _background_session_factory(db),
    )

    return {
        "status": "success",
        "job_id": job.id,
        "config_id": committed_config.id,
        "message": "Rebuild job queued.",
    }
"""

if "rebuild_device_firmware" not in api_text:
    new_text = api_text.replace(
        '@router.delete("/device/{device_id}")',
        endpoint_code + '\n@router.delete("/device/{device_id}")'
    )
    with open("server/app/api.py", "w") as f:
        f.write(new_text)
    print("Added rebuild_device_firmware endpoint.")
else:
    print("Endpoint already exists.")
