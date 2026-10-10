from django.db import migrations


def delete_unlinked_sessions(apps, schema_editor):
    InterviewSession = apps.get_model('interview', 'InterviewSession')
    deleted, _ = InterviewSession.objects.filter(owner__isnull=True).delete()
    print(f"  Deleted {deleted} unlinked session(s) with owner=NULL")


class Migration(migrations.Migration):

    dependencies = [
        ('interview', '0015_add_theme_to_userprofile'),
    ]

    operations = [
        migrations.RunPython(
            delete_unlinked_sessions,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
