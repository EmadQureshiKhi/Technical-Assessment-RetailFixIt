"""
RetailFixIt AI-Orchestrated Vendor Dispatch System
High-Level Azure Architecture Diagram

Only includes Azure services that are actually implemented in the codebase.
"""

from diagrams import Cluster, Diagram, Edge

# Azure Compute
from diagrams.azure.compute import FunctionApps

# Azure Database
from diagrams.azure.database import CosmosDb, SQLDatabases, CacheForRedis

# Azure Integration
from diagrams.azure.integration import EventGridDomains, ServiceBus

# Azure AI/ML
from diagrams.azure.ml import MachineLearningServiceWorkspaces

# Azure Analytics
from diagrams.azure.analytics import LogAnalyticsWorkspaces

# Azure Web
from diagrams.azure.web import StaticApps

# Azure DevOps/Monitor
from diagrams.azure.devops import ApplicationInsights

# Azure Identity
from diagrams.azure.identity import ActiveDirectory

# Azure Security
from diagrams.azure.security import KeyVaults

# Azure Storage
from diagrams.azure.storage import BlobStorage

# Generic
from diagrams.generic.compute import Rack
from diagrams.onprem.client import Users

# Graph attributes for professional look
graph_attr = {
    "fontsize": "16",
    "fontname": "Helvetica",
    "bgcolor": "#f8f9fa",
    "pad": "1.0",
    "splines": "ortho",
    "nodesep": "0.7",
    "ranksep": "0.9",
    "dpi": "150",
}

cluster_attr = {
    "fontsize": "14",
    "fontname": "Helvetica Bold",
}

with Diagram(
    "RetailFixIt - AI-Orchestrated Vendor Dispatch System",
    show=False,
    direction="TB",
    filename="retailfixit_azure_architecture",
    outformat="png",
    graph_attr=graph_attr,
):
    
    # ===== EXTERNAL USERS =====
    with Cluster("External", graph_attr={"bgcolor": "#e8f4f8", **cluster_attr}):
        operators = Users("Dispatch\nOperators")
    
    # ===== EVENT SOURCES =====
    with Cluster("Event Sources", graph_attr={"bgcolor": "#fff3e0", **cluster_attr}):
        job_portal = Rack("Job Portal")
        vendor_portal = Rack("Vendor Portal")
        dispatch_sys = Rack("Dispatch\nSystem")
    
    # ===== SECURITY & IDENTITY =====
    with Cluster("Security & Identity", graph_attr={"bgcolor": "#fce4ec", **cluster_attr}):
        aad = ActiveDirectory("Azure AD")
        key_vault = KeyVaults("Key Vault")
    
    # ===== FRONTEND =====
    with Cluster("Frontend", graph_attr={"bgcolor": "#e8f5e9", **cluster_attr}):
        admin_ui = StaticApps("Static Web App\n(Admin UI)")
    
    # ===== EVENT INGESTION =====
    with Cluster("Event Ingestion", graph_attr={"bgcolor": "#fff8e1", **cluster_attr}):
        event_grid = EventGridDomains("Event Grid")
        service_bus = ServiceBus("Service Bus")
        dlq = ServiceBus("Dead Letter\nQueue")
    
    # ===== AI SERVICES =====
    with Cluster("AI Services (Azure Functions)", graph_attr={"bgcolor": "#f3e5f5", **cluster_attr}):
        event_handler = FunctionApps("Event\nHandler")
        scoring_func = FunctionApps("Vendor Scoring\nService")
        explain_func = FunctionApps("Explainability\nService")
    
    # ===== ML PLATFORM =====
    with Cluster("ML Platform", graph_attr={"bgcolor": "#e1f5fe", **cluster_attr}):
        ml_workspace = MachineLearningServiceWorkspaces("Azure ML\nWorkspace")
        ml_endpoint = MachineLearningServiceWorkspaces("ML Endpoint")
        model_storage = BlobStorage("Model\nArtifacts")
    
    # ===== DATA LAYER =====
    with Cluster("Data Layer", graph_attr={"bgcolor": "#e0f2f1", **cluster_attr}):
        cosmos_db = CosmosDb("Cosmos DB\n(Vendors, Jobs)")
        redis = CacheForRedis("Redis Cache")
        sql_db = SQLDatabases("Azure SQL\n(Audit, Metrics)")
    
    # ===== OBSERVABILITY =====
    with Cluster("Observability", graph_attr={"bgcolor": "#ffebee", **cluster_attr}):
        app_insights = ApplicationInsights("Application\nInsights")
        log_analytics = LogAnalyticsWorkspaces("Log Analytics")
    
    # ========================================
    # CONNECTIONS
    # ========================================
    
    # --- USER FLOW (Green) ---
    operators >> Edge(color="#2e7d32", style="bold") >> aad
    aad >> Edge(color="#2e7d32") >> admin_ui
    admin_ui >> Edge(color="#2e7d32") >> scoring_func
    
    # --- EVENT FLOW (Blue) ---
    job_portal >> Edge(color="#1565c0") >> event_grid
    vendor_portal >> Edge(color="#1565c0") >> event_grid
    dispatch_sys >> Edge(color="#1565c0") >> event_grid
    
    event_grid >> Edge(color="#1565c0") >> service_bus
    service_bus >> Edge(color="#1565c0") >> event_handler
    service_bus - Edge(color="#c62828", style="dashed") - dlq
    
    event_handler >> Edge(color="#1565c0") >> scoring_func
    scoring_func >> Edge(color="#1565c0") >> event_grid
    
    # --- AI/ML FLOW (Purple) ---
    scoring_func >> Edge(color="#7b1fa2", style="bold") >> ml_endpoint
    scoring_func >> Edge(color="#7b1fa2") >> explain_func
    ml_workspace >> Edge(color="#7b1fa2", style="dashed") >> ml_endpoint
    ml_workspace >> Edge(color="#7b1fa2", style="dashed") >> model_storage
    
    # --- DATA FLOW (Orange) ---
    scoring_func >> Edge(color="#ef6c00") >> cosmos_db
    scoring_func >> Edge(color="#ef6c00") >> redis
    scoring_func >> Edge(color="#ef6c00") >> sql_db
    explain_func >> Edge(color="#ef6c00") >> cosmos_db
    
    # --- SECURITY FLOW (Gray) ---
    scoring_func >> Edge(color="#616161", style="dotted") >> key_vault
    ml_endpoint >> Edge(color="#616161", style="dotted") >> key_vault
    
    # --- MONITORING FLOW (Red dashed) ---
    scoring_func >> Edge(color="#b71c1c", style="dashed") >> app_insights
    event_handler >> Edge(color="#b71c1c", style="dashed") >> app_insights
    ml_endpoint >> Edge(color="#b71c1c", style="dashed") >> app_insights
    app_insights >> Edge(color="#b71c1c", style="dashed") >> log_analytics


print("=" * 60)
print("Diagram generated: retailfixit_azure_architecture.png")
print("=" * 60)
