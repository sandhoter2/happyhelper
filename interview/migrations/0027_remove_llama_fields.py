from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("interview", "0026_featurerequest"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="documentfolder",
            name="llama_directory_id",
        ),
        migrations.RemoveField(
            model_name="documentfolder",
            name="llama_index_id",
        ),
        migrations.RemoveField(
            model_name="userdocument",
            name="llama_job_id",
        ),
        migrations.RemoveField(
            model_name="userdocument",
            name="llama_file_id",
        ),
        migrations.RemoveField(
            model_name="userdocument",
            name="llama_cloud_synced",
        ),
        migrations.AlterField(
            model_name="documentparserconfig",
            name="parser_type",
            field=models.CharField(default="default", max_length=30, unique=True),
        ),
    ]
