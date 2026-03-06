from django.urls import path
from . import views

urlpatterns = [
    path('',              views.index,   name='index'),
    path('api/latest',    views.latest,  name='latest'),
    path('api/metrics',   views.metrics, name='metrics'),
    path('api/chat',      views.chat,    name='chat'),
]
