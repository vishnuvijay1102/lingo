pipeline {
    agent any

    stages {

        stage('Pull latest code') {
            steps {
                echo 'Pulling latest code...'
                dir('/var/www/lingo') {
                    sh 'git pull origin main'
                }
            }
        }

        stage('Build Docker image') {
            steps {
                echo 'Building...'
                dir('/var/www/lingo') {
                    sh 'docker compose build --no-cache'
                }
            }
        }

        stage('Deploy') {
            steps {
                echo 'Deploying...'
                dir('/var/www/lingo') {
                    sh 'docker compose up -d'
                }
            }
        }

    }

    post {
        success {
            echo 'Deployed successfully.'
        }
        failure {
            echo 'Build failed.'
        }
    }
}