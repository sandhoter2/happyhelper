FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Static files collected once at image build time so cold starts skip this step
RUN python manage.py collectstatic --no-input && chmod +x build.sh
EXPOSE 8000
CMD ["sh", "-c", "./build.sh && gunicorn happyhelper.wsgi:application --bind 0.0.0.0:8000"]
