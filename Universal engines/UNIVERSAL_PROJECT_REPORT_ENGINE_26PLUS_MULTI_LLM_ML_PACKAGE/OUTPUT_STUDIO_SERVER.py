#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Standalone FastAPI host for the drop-in Output Studio module.
Python AI Programming by Eng. Ahmed Labib
"""
from fastapi import FastAPI
from OUTPUT_STUDIO_PROJECT_CONTROLS_WEB import ATTRIBUTION, create_router
app=FastAPI(title="Project Controls Output Studio",version="1.0.0",description=ATTRIBUTION)
app.include_router(create_router())
@app.get("/")
def root():return {"attribution":ATTRIBUTION,"status":"READY","docs":"/docs","health":"/api/project-controls/health"}
