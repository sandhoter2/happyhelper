from django.conf import settings


def app_version(request):
    return {"GIT_COMMIT": getattr(settings, "GIT_COMMIT", "local")}
