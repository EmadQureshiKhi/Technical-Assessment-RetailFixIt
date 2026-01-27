"""
RetailFixIt AI-Orchestrated Vendor Dispatch System
High-Level Azure Architecture Diagram

Run with: python azure_architecture.py

Prerequisites:
    pip install diagrams
    brew install graphviz  # macOS
"""

from diagrams import Cluster, Diagram, Edge

# Azure imports
from diagrams.azure.compute import FunctionApps
from diagrams.azure.database import CosmosDb, SQLDatabases, CacheForRedis
from diagrams.azure.integration import EventGridDomains, ServiceBus, APIManagementServices
from diagrams.azure.ml import MachineLearningServiceWorkspaces
from diagrams.azure.analytics import LogAnalyticsWorkspaces, DataFactories
from diagrams.azure.web import AppServices, StaticApps
from diagrams.azure.devops import ApplicationInsights
from diagrams.azure.identity import ActiveDirectory
from diagrams.azure.security import KeyVaults
from diagrams.azure.storage import BlobStorage

# Generic
from diagrams.generic.compute import Rack
from diagrams.onprem.client import Users

# Graph attributes
graph_attr = {
    "fontsize": "20",
    "bgcolor": "white",
    "pad": "0.8",
    "splines": "ortho",
    "nodesep": "0.8",
    "ranksep": "1.0",
}

with Diagram(
    "RetailFixIt - AI-Orchestrated Vendor Dispatch System",
    show=False,
    direction="TB",
    filename="retailfixit_azure_architecture",
    outformat="png",
    graph_attr=graph_attr,
):
    
    # ===== ROW 1: EXTERNAL USERS & SOURCES =====
    with Cluster("External"):
        operator = Users("Dispatch\nOperators")
        
    with Cluster("Event Sources"):
        job_portal = Rack("Job\nPortal")
        vendor_portal = Rack("Vendor\nPortal")
        dispatch_sys = Rack("Dispatch\nSystem")
    
    # ===== ROW 2: SECURITY & INGESTION =====
    with Cluster("Identity & Security"):
        aad = ActiveDirectory("Azure AD\nAuthentication")
        key_vault = KeyVaults("Key Vault\nSecrets")
    
    with Cluster("Event Ingestion"):
        event_grid = EventGridDomains("Event Grid\nTopics")
        service_bus = ServiceBus("Service Bus\nQueues")
        dlq = ServiceBus("Dead Letter\nQueue")
    
    # ===== ROW 3: FRONTEND & API =====
    with Cluster("Frontend & API Layer"):
        admin_ui = StaticApps("Static Web App\nAdmin UI")
        api_mgmt = APIManagementServices("API Management\nGateway")
    
    # ===== ROW 4: AI SERVICES =====
    with Cluster("AI Services (Azure Functions)"):
        event_handler = FunctionApps("Event\nHandler")
        scoring_func = FunctionApps("Vendor Scoring\nService")
        explain_func = FunctionApps("Explainability\nService")
    
    # ===== ROW 5: ML PLATFORM =====
    with Cluster("ML Platform"):
        ml_workspace = MachineLearningServiceWorkspaces("Azure ML\nWorkspace")
        ml_endpoint = MachineLearningServiceWorkspaces("ML Endpoint\nPredictions")
        model_storage = BlobStorage("Model\nArtifacts")
    
    # ===== ROW 6: DATA LAYER =====
    with Cluster("Data Layer"):
        cosmos_db = CosmosDb("Cosmos DB\nVendors & Jobs")
        redis = CacheForRedis("Redis Cache\nFeatures")
        sql_db = SQLDatabases("Azure SQL\nAudit & Metrics")
    
    # ===== ROW 7: ML PIPELINE =====
    with Cluster("ML Training Pipeline"):
        data_factory = DataFactories("Data Factory\nFeature Pipeline")
    
    # ===== ROW 8: OBSERVABILITY =====
    with Cluster("Observability"):
        app_insights = ApplicationInsights("Application\nInsights")
        log_analytics = LogAnalyticsWorkspaces("Log Analytics\nWorkspace")
    
    # ========================================
    # CONNECTIONS - Organized by flow type
    # ========================================
    
    # --- USER FLOW (Green) ---
    operator >> Edge(color="green") >> aad
    aad >> Edge(color="green") >> admin_ui
    admin_ui >> Edge(color="green") >> api_mgmt
    api_mgmt >> Edge(color="green") >> scoring_func
    
    # --- EVENT FLOW (Blue) ---
    job_portal >> Edge(color="blue") >> event_grid
    vendor_portal >> Edge(color="blue") >> event_grid
    dispatch_sys >> Edge(color="blue") >> event_grid
    
    event_grid >> Edge(color="blue") >> service_bus
    service_bus >> Edge(color="blue") >> event_handler
    service_bus - Edge(color="red", style="dashed") - dlq
    
    event_handler >> Edge(color="blue") >> scoring_func
    scoring_func >> Edge(color="blue") >> event_grid
    
    # --- AI/ML FLOW (Purple) ---
    scoring_func >> Edge(color="purple") >> ml_endpoint
    scoring_func >> Edge(color="purple") >> explain_func
    ml_workspace >> Edge(color="purple", style="dashed") >> ml_endpoint
    ml_workspace >> Edge(color="purple", style="dashed") >> model_storage
    
    # --- DATA FLOW (Orange) ---
    scoring_func >> Edge(color="orange") >> cosmos_db
    scoring_func >> Edge(color="orange") >> redis
    scoring_func >> Edge(color="orange") >> sql_db
    explain_func >> Edge(color="orange") >> cosmos_db
    
    # --- ML TRAINING FLOW (Brown) ---
    sql_db >> Edge(color="brown", style="dashed") >> data_factory
    cosmos_db >> Edge(color="brown", style="dashed") >> data_factory
    data_factory >> Edge(color="brown", style="dashed") >> ml_workspace
    
    # --- SECURITY FLOW (Gray) ---
    scoring_func >> Edge(color="gray", style="dotted") >> key_vault
    ml_endpoint >> Edge(color="gray", style="dotted") >> key_vault
    
    # --- MONITORING FLOW (Red dashed) ---
    scoring_func >> Edge(color="darkred", style="dashed") >> app_insights
    event_handler >> Edge(color="darkred", style="dashed") >> app_insights
    ml_endpoint >> Edge(color="darkred", style="dashed") >> app_insights
    api_mgmt >> Edge(color="darkred", style="dashed") >> app_insights
    app_insights >> Edge(color="darkred", style="dashed") >> log_analytics


print("=" * 60)
print("Diagram generated: retailfixit_azure_architecture.png")
print("=" * 60)
print("\nConnection Legend:")
print("  🟢 Green:        User/Authentication flow")
print("  🔵 Blue:         Event processing flow")
print("  🟣 Purple:       AI/ML prediction flow")
print("  🟠 Orange:       Data read/write flow")
print("  🟤 Brown dashed: ML training data flow")
print("  ⚫ Gray dotted:  Security/secrets flow")
print("  🔴 Red dashed:   Monitoring/telemetry flow")
print("\nAzure Services Used:")
print("  - Azure Functions (AI Services)")
print("  - Azure Event Grid & Service Bus (Messaging)")
print("  - Azure ML Workspace & Endpoints (ML Platform)")
print("  - Azure Cosmos DB, SQL, Redis (Data Layer)")
print("  - Azure Static Web Apps & API Management (Frontend)")
print("  - Azure AD & Key Vault (Security)")
print("  - Application Insights & Log Analytics (Monitoring)")
